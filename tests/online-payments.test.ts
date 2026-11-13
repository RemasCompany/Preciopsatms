import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const mail = vi.hoisted(() => ({ sent: [] as { to: string | string[]; subject: string; text: string; attachments?: { filename: string; content: Buffer }[] }[] }));
const checkout = vi.hoisted(() => ({ calls: [] as { args: Record<string, unknown>; opts: Record<string, unknown> }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: (typeof mail.sent)[number]) => { mail.sent.push(o); return { id: `em_${mail.sent.length}` }; }) }));
vi.mock('@/lib/stripe', async (orig) => ({
  ...(await orig<typeof import('@/lib/stripe')>()),
  stripeEnabled: () => true,
  stripe: { checkout: { sessions: { create: vi.fn(async (args: Record<string, unknown>, opts: Record<string, unknown>) => { checkout.calls.push({ args, opts }); return { url: 'https://checkout.stripe.test/s' }; }) } } },
}));

import { db } from '@/lib/db';
import { cardFeeCents, reminderStep } from '@/lib/invoicing';
import { handleConnectEvent, payOptions, startCheckout } from '@/lib/online-payments';
import { reminderEmail, runInvoiceReminders } from '@/lib/invoice-reminders';
import { PATCH as SETTINGS } from '@/app/api/payments/settings/route';

describe('payment math', () => {
  it('adds the card fee to cards only, capped at 3%', () => {
    expect(cardFeeCents(316500, 3)).toBe(9495);
    expect(cardFeeCents(10000, 2.9)).toBe(290);
    expect(cardFeeCents(10000, 5)).toBe(300); // never over the cap
    expect([cardFeeCents(10000, 0), cardFeeCents(0, 3)]).toEqual([0, 0]);
    expect(payOptions({ cardFeePct: 3 as never }, 10000)).toEqual({ ach: { amount: 10000, fee: 0 }, card: { amount: 10300, fee: 300 } });
  });
  it('follows the reminder schedule, one step at a time', () => {
    const due = '2026-10-15', sent = '2026-10-01';
    expect(reminderStep(due, '2026-10-11', 0, null, sent)).toBeNull(); // 4 days before: nothing yet
    expect(reminderStep(due, '2026-10-12', 0, null, sent)).toBe(0); // 3 days before
    expect(reminderStep(due, '2026-10-13', 1, '2026-10-12', sent)).toBeNull(); // already sent that step
    expect(reminderStep(due, '2026-10-15', 1, '2026-10-12', sent)).toBe(1); // due date
    expect(reminderStep(due, '2026-10-22', 2, '2026-10-15', sent)).toBe(2); // 7 days past due
    expect(reminderStep(due, '2027-02-01', 7, '2027-01-13', sent)).toBeNull(); // schedule finished
  });
  it('skips missed steps and never piles reminders up', () => {
    // Emailed 20 days after it was due: nothing that day, then one "past due" reminder (the 14-day step), not three.
    expect(reminderStep('2026-10-01', '2026-10-21', 0, null, '2026-10-21')).toBeNull();
    expect(reminderStep('2026-10-01', '2026-10-22', 0, null, '2026-10-21')).toBe(3);
    // A step comes due a day after the last reminder: wait out the gap.
    expect(reminderStep('2026-10-01', '2026-10-31', 4, '2026-10-30', '2026-09-20')).toBeNull();
  });
  it('words the reminder for where the invoice stands', () => {
    const base = { company: 'Remas', number: 'INV-2026-0007', client: 'Harbor Point', poNumber: 'PO-9', balance: 125000, due: new Date('2026-10-15T00:00:00Z'), payLink: 'https://app.test/pay/abc', cardFeePct: 3, remit: 'Checks to 1 Main St', greeting: 'Rita' };
    expect(reminderEmail({ ...base, daysFromDue: -3 }).subject).toBe('Reminder: invoice INV-2026-0007 (PO PO-9) for $1,250.00 is due Oct 15, 2026');
    expect(reminderEmail({ ...base, daysFromDue: 0 }).subject).toBe('Invoice INV-2026-0007 (PO PO-9) for $1,250.00 is due today');
    const late = reminderEmail({ ...base, daysFromDue: 14 });
    expect(late.subject).toBe('Past due: invoice INV-2026-0007 (PO PO-9) for $1,250.00 was due Oct 15, 2026');
    expect(late.text).toContain('now 14 days past due');
    expect(late.text).toContain('Pay online: https://app.test/pay/abc');
    expect(late.text).toContain('cards add a 3% processing fee');
    expect(late.text).toContain('Other ways to pay:\nChecks to 1 Main St');
    expect(reminderEmail({ ...base, daysFromDue: 14, payLink: null }).text).toContain('How to pay:\nChecks to 1 Main St');
  });
});

const RUN = `pay${Date.now()}`;
let org: string, other: string, admin: string, client: string, invId: string, token: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const ACCT = `acct_${RUN}`;
const sessionEvent = (type: string, s: Partial<Stripe.Checkout.Session>, account = ACCT) =>
  ({ type, account, data: { object: { payment_status: 'paid', ...s } } }) as unknown as Stripe.Event;
const meta = (o: Record<string, string>) => ({ orgId: org, invoiceId: invId, ...o });

beforeAll(async () => {
  const mk = (n: string, extra: object = {}) => db.organization.create({ data: { name: `${n} Staffing`, slug: `${n}-${RUN}`, plan: 'growth', subscriptionStatus: 'active', timezone: 'America/New_York', ...extra } }).then((o) => o.id);
  org = await mk('pay', { stripeConnectAccountId: ACCT, stripeConnectReady: true, onlinePayments: true, cardFeePct: 3, invoiceReminders: true, remitInstructions: 'Checks to 1 Main St' });
  other = await mk('oth', { stripeConnectAccountId: `acct_other_${RUN}`, stripeConnectReady: true });
  admin = (await db.user.create({ data: { email: `admin@${RUN}.test`, name: 'Admin', passwordHash: 'x' } })).id;
  await db.membership.create({ data: { userId: admin, organizationId: org, role: 'ADMIN' } });
  client = (await db.client.create({ data: { organizationId: org, name: 'Harbor Point', paymentTerms: 'Net 15', billingEmail: 'ap@harbor.test' } })).id;
  await db.contact.create({ data: { organizationId: org, clientId: client, name: 'Rita Alvarez', email: 'rita@harbor.test' } });
  await db.contact.create({ data: { organizationId: org, clientId: client, name: 'Opted Out', email: 'gone@harbor.test', emailOptOut: true } });
  token = `tok_${RUN}_abcdefghijklmnop`;
  invId = (await db.invoice.create({ data: {
    organizationId: org, clientId: client, number: `INV-${RUN}`, status: 'SENT', issueDate: new Date('2026-10-01T00:00:00Z'), dueDate: new Date('2026-10-16T00:00:00Z'),
    periodStart: new Date('2026-09-21T00:00:00Z'), periodEnd: new Date('2026-09-27T00:00:00Z'), terms: 'Net 15', subtotal: 1000, total: 1000,
    sentAt: new Date('2026-10-01T15:00:00Z'), sentTo: 'rita@harbor.test, gone@harbor.test, ap@harbor.test', payToken: token,
    lines: { create: { organizationId: org, worker: 'Ana Diaz', description: 'Forklift Operator', regularHours: 40, rate: 25, amount: 1000 } },
  } })).id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});
beforeEach(() => { mail.sent = []; checkout.calls = []; });

describe('online payments', () => {
  it('opens Checkout on the firm’s own account, with the card fee as its own line', async () => {
    expect(await startCheckout(token, 'card')).toBe('https://checkout.stripe.test/s');
    const { args, opts } = checkout.calls[0];
    expect(opts).toEqual({ stripeAccount: ACCT });
    expect(args.payment_method_types).toEqual(['card']);
    expect((args.line_items as { price_data: { unit_amount: number } }[]).map((l) => l.price_data.unit_amount)).toEqual([100000, 3000]);
    await startCheckout(token, 'ach');
    expect(checkout.calls[1].args.payment_method_types).toEqual(['us_bank_account']);
    expect((checkout.calls[1].args.line_items as unknown[]).length).toBe(1); // no fee on bank transfers
    await expect(startCheckout('not-a-real-token-at-all-000', 'card')).rejects.toThrow('This payment link isn’t valid');
  });

  it('records a payment only from the company’s own account, once, without the card fee', async () => {
    const s = { id: 'cs_1', payment_intent: `pi_${RUN}_1`, amount_total: 40000 + 1200, metadata: meta({ feeCents: '1200', method: 'card' }) };
    expect(await handleConnectEvent(sessionEvent('checkout.session.completed', s, `acct_other_${RUN}`))).toBe('ignored');
    expect(await handleConnectEvent(sessionEvent('checkout.session.completed', { ...s, metadata: { ...s.metadata, orgId: other } }, `acct_other_${RUN}`))).toBe('ignored');
    expect(await handleConnectEvent(sessionEvent('checkout.session.completed', s))).toBe('recorded');
    expect(await handleConnectEvent(sessionEvent('checkout.session.completed', s))).toBe('duplicate'); // Stripe resends
    const inv = await db.invoice.findUnique({ where: { id: invId }, include: { payments: true } });
    expect(inv!.payments.map((p) => [Number(p.amount), p.method])).toEqual([[400, 'card']]);
    expect(inv).toMatchObject({ status: 'PARTIAL' });
    expect(Number(inv!.amountPaid)).toBe(400);
  });

  it('waits for the bank on transfers, then marks the invoice paid', async () => {
    const s = { id: 'cs_2', payment_intent: `pi_${RUN}_2`, amount_total: 60000, metadata: meta({ feeCents: '0', method: 'ach' }) };
    expect(await handleConnectEvent(sessionEvent('checkout.session.completed', { ...s, payment_status: 'unpaid' }))).toBe('pending');
    expect(await db.payment.count({ where: { invoiceId: invId } })).toBe(1);
    expect(await handleConnectEvent(sessionEvent('checkout.session.async_payment_succeeded', s))).toBe('recorded');
    const inv = await db.invoice.findUnique({ where: { id: invId } });
    expect(inv).toMatchObject({ status: 'PAID' });
    await expect(startCheckout(token, 'ach')).rejects.toThrow('already paid');
  });

  it('turns online payments on only with a ready Stripe account, and caps the card fee', async () => {
    as(admin);
    const patch = (b: object) => SETTINGS(new Request('http://x', { method: 'PATCH', body: JSON.stringify(b) }));
    expect((await (await patch({ cardFeePct: 4 })).json()).error).toBe('Card fees can be at most 3% (card network rules).');
    await db.organization.update({ where: { id: org }, data: { stripeConnectReady: false } });
    expect((await patch({ onlinePayments: true })).status).toBe(409);
    await db.organization.update({ where: { id: org }, data: { stripeConnectReady: true } });
    expect((await patch({ onlinePayments: true, cardFeePct: 2.5 })).status).toBe(200);
    expect(Number((await db.organization.findUnique({ where: { id: org } }))!.cardFeePct)).toBe(2.5);
  });
});

describe('payment reminders', () => {
  let open: string;
  beforeAll(async () => {
    open = (await db.invoice.create({ data: {
      organizationId: org, clientId: client, number: `INV-${RUN}-2`, status: 'SENT', issueDate: new Date('2026-10-01T00:00:00Z'), dueDate: new Date('2026-10-16T00:00:00Z'),
      periodStart: new Date('2026-09-21T00:00:00Z'), periodEnd: new Date('2026-09-27T00:00:00Z'), terms: 'Net 15', subtotal: 500, total: 500,
      sentAt: new Date('2026-10-01T15:00:00Z'), sentTo: 'rita@harbor.test, gone@harbor.test, ap@harbor.test',
      lines: { create: { organizationId: org, worker: 'Ben Cole', description: 'Picker', regularHours: 20, rate: 25, amount: 500 } },
    } })).id;
  });

  it('emails each recipient once per step, with the PDF and a Pay online link, skipping unsubscribed contacts', async () => {
    const now = new Date('2026-10-23T14:10:00Z'); // 7 days past due
    await runInvoiceReminders(now);
    const mine = mail.sent.filter((m) => m.subject.includes(`INV-${RUN}-2`));
    expect(mine.map((m) => m.to).sort()).toEqual(['ap@harbor.test', 'rita@harbor.test']);
    expect(mine[0].subject).toMatch(/^Past due: invoice INV-.*-2 for \$500\.00 was due Oct 16, 2026$/);
    expect(mine[0].text).toMatch(/Pay online: http.*\/pay\/[\w-]{20,}/);
    expect(mine[0].attachments![0].content.subarray(0, 4).toString()).toBe('%PDF');
    expect(mail.sent.some((m) => m.subject.includes(`INV-${RUN} `))).toBe(false); // the paid one gets nothing
    expect(await db.message.count({ where: { organizationId: org, toAddress: 'gone@harbor.test', status: 'blocked_opt_out' } })).toBe(1);
    expect(await db.invoice.findUnique({ where: { id: open } })).toMatchObject({ remindersSent: 3 });
    mail.sent = [];
    await runInvoiceReminders(now); // the same day again: nothing new
    expect(mail.sent.filter((m) => m.subject.includes(`INV-${RUN}-2`))).toHaveLength(0);
  });

  it('stops when the company turns reminders off', async () => {
    await db.organization.update({ where: { id: org }, data: { invoiceReminders: false } });
    await runInvoiceReminders(new Date('2026-10-31T14:10:00Z')); // the 14-day step
    expect(mail.sent.filter((m) => m.subject.includes(`INV-${RUN}-2`))).toHaveLength(0);
  });
});
