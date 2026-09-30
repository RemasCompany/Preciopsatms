import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const mail = vi.hoisted(() => ({ sent: [] as { to: string | string[]; subject: string; text: string; attachments?: { filename: string; content: Buffer }[] }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: (typeof mail.sent)[number]) => { mail.sent.push(o); return { id: `em_${mail.sent.length}` }; }) }));

import { db } from '@/lib/db';
import { aging, bucketFor, daysOverdue, dso, lineCents, statusFor, termsDays } from '@/lib/invoicing';
import { scheduledHours } from '@/lib/schedule-fill';
import { POST as CREATE } from '@/app/api/invoices/route';
import { PATCH as VOID } from '@/app/api/invoices/[id]/route';
import { POST as SEND } from '@/app/api/invoices/[id]/send/route';
import { POST as PAY } from '@/app/api/invoices/[id]/payments/route';
import { DELETE as UNPAY } from '@/app/api/invoices/[id]/payments/[pid]/route';
import { GET as PDF } from '@/app/api/invoices/[id]/pdf/route';
import { GET as AGING } from '@/app/api/invoices/aging/route';
import { POST as FILL } from '@/app/api/timesheets/fill-schedule/route';
import { DELETE as DELETE_RECORD } from '@/app/api/records/[kind]/[id]/route';

describe('invoice math', () => {
  it('bills overtime at 1.5x, in cents', () => {
    expect(lineCents(40, 5, 30)).toBe(142500);
    expect(lineCents(7.25, 0, 33.33)).toBe(24164); // 241.6425 → $241.64
  });
  it('reads payment terms', () => {
    expect([termsDays('Net 30'), termsDays('Net 15'), termsDays('Due on receipt'), termsDays('whenever')]).toEqual([30, 15, 0, 30]);
  });
  it('follows the money for status', () => {
    expect([statusFor(1000, 0, false), statusFor(1000, 0, true), statusFor(1000, 400, true), statusFor(1000, 1000, false), statusFor(1000, 0, true, true)]).toEqual(['DRAFT', 'SENT', 'PARTIAL', 'PAID', 'VOID']);
  });
  it('ages balances into buckets at the edges', () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91].map(bucketFor)).toEqual(['current', 'd1', 'd1', 'd31', 'd31', 'd61', 'd61', 'd90']);
    expect(daysOverdue('2026-09-01', '2026-09-30')).toBe(29);
    expect(daysOverdue('2026-10-15', '2026-09-30')).toBe(0);
    const r = aging([
      { clientId: 'a', client: 'Acme', dueDate: '2026-10-10', balanceCents: 1000 },
      { clientId: 'a', client: 'Acme', dueDate: '2026-06-01', balanceCents: 500 },
      { clientId: 'b', client: 'Bolt', dueDate: '2026-09-15', balanceCents: 2000 },
      { clientId: 'b', client: 'Bolt', dueDate: '2026-09-15', balanceCents: 0 },
    ], '2026-09-30');
    expect(r.rows.map((x) => [x.client, x.total, x.oldest])).toEqual([['Bolt', 2000, 15], ['Acme', 1500, 121]]);
    expect(r.totals).toEqual({ current: 1000, d1: 2000, d31: 0, d61: 0, d90: 500, total: 3500 });
    expect([dso(3500, 9000, 90), dso(0, 0)]).toEqual([35, null]);
  });
  it('turns scheduled hours past 40 into overtime', () => {
    const day = (applicationId: string) => ({ applicationId, start: '07:00', end: '17:30', breakMinutes: 30 }); // 10h
    expect(scheduledHours([day('a'), day('a'), day('a'), day('a'), day('a'), day('b')])).toEqual([
      { applicationId: 'a', regularHours: 40, overtimeHours: 10 }, { applicationId: 'b', regularHours: 10, overtimeHours: 0 },
    ]);
    expect(scheduledHours([{ applicationId: 'n', start: '22:00', end: '06:00', breakMinutes: 0 }])).toEqual([{ applicationId: 'n', regularHours: 8, overtimeHours: 0 }]);
  });
});

const RUN = `inv${Date.now()}`;
let org: string, other: string, admin: string, rec: string, outsider: string, client: string, contact: string, noEmail: string, appA: string, appB: string;
const WEEK = '2026-09-20', PREV = '2026-09-13';
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const req = (method: string, body?: object) => new Request('http://x', { method, body: body ? JSON.stringify(body) : undefined });
const P = (id: string) => ({ params: { id } });
const ts = (applicationId: string, week: string, reg: number, ot: number, status = 'APPROVED') => db.timesheet.create({ data: { organizationId: org, applicationId, weekEnding: new Date(`${week}T00:00:00Z`), regularHours: reg, overtimeHours: ot, payRate: 20, billRate: 30, status: status as never } });

beforeAll(async () => {
  const mk = (n: string) => db.organization.create({ data: { name: `${n} Staffing`, slug: `${n}-${RUN}`, plan: 'growth', subscriptionStatus: 'active', timezone: 'America/New_York' } }).then((o) => o.id);
  [org, other] = await Promise.all([mk('inv'), mk('oth')]);
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [admin, rec, outsider] = await Promise.all([u('admin'), u('rec'), u('out')]);
  await db.membership.createMany({ data: [{ userId: admin, organizationId: org, role: 'ADMIN' }, { userId: rec, organizationId: org, role: 'RECRUITER' }, { userId: outsider, organizationId: other, role: 'OWNER' }] });
  client = (await db.client.create({ data: { organizationId: org, name: 'Harbor Point', paymentTerms: 'Net 15' } })).id;
  contact = (await db.contact.create({ data: { organizationId: org, clientId: client, name: 'Rita Alvarez', email: 'rita@harbor.test' } })).id;
  noEmail = (await db.contact.create({ data: { organizationId: org, clientId: client, name: 'No Mail' } })).id;
  const job = await db.job.create({ data: { organizationId: org, clientId: client, title: 'Forklift Operator', type: 'TEMP', payRate: 20, billRate: 30 } });
  const c = (n: string) => db.candidate.create({ data: { organizationId: org, name: n } }).then((x) => x.id);
  const [ca, cb] = await Promise.all([c('Ana Diaz'), c('Ben Cole')]);
  appA = (await db.application.create({ data: { organizationId: org, candidateId: ca, jobId: job.id, stage: 'PLACED' } })).id;
  appB = (await db.application.create({ data: { organizationId: org, candidateId: cb, jobId: job.id, stage: 'PLACED' } })).id;
  await ts(appA, WEEK, 40, 5); await ts(appB, WEEK, 20, 0); await ts(appA, PREV, 38, 0); await ts(appB, PREV, 10, 0, 'DRAFT');
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

let invId: string;
describe('invoices', () => {
  it('bill approved hours once, only for admins in the company', async () => {
    as(rec);
    expect((await CREATE(req('POST', { clientId: client, from: PREV, to: WEEK }))).status).toBe(403);
    as(outsider, other);
    expect((await CREATE(req('POST', { clientId: client, from: PREV, to: WEEK }))).status).toBe(404);
    as(admin);
    const [a, b] = await Promise.all([CREATE(req('POST', { clientId: client, from: PREV, to: WEEK })), CREATE(req('POST', { clientId: client, from: PREV, to: WEEK }))]);
    expect([a.status, b.status].sort()).toEqual([201, 409]); // two clicks at once: one invoice
    invId = (await (a.status === 201 ? a : b).json()).id;
    const inv = await db.invoice.findUnique({ where: { id: invId }, include: { lines: true } });
    // 40×30 + 5×45 + 20×30 + 38×30 = 1200 + 225 + 600 + 1140 = 3165; the draft week isn't billed.
    expect(Number(inv!.total)).toBe(3165);
    expect(inv!.lines).toHaveLength(3);
    expect(inv!.number).toMatch(new RegExp(`^INV-${new Date().getUTCFullYear()}-0001$`));
    expect(inv!.status).toBe('DRAFT');
    expect(inv!.dueDate.getTime() - inv!.issueDate.getTime()).toBe(15 * 864e5);
    const again = await CREATE(req('POST', { clientId: client, from: PREV, to: WEEK }));
    expect((await again.json()).error).toBe('There are no approved hours for Harbor Point in that period that aren’t already invoiced.');
  });

  it('emails each contact the PDF and marks it sent', async () => {
    expect((await (await SEND(req('POST', { contactIds: [noEmail] }), P(invId))).json()).error).toBe('No Mail has no email address.');
    mail.sent = [];
    expect((await SEND(req('POST', { contactIds: [contact], message: 'Thanks for your business.' }), P(invId))).status).toBe(200);
    expect(mail.sent[0]).toMatchObject({ to: 'rita@harbor.test' });
    expect(mail.sent[0].subject).toMatch(/^Invoice INV-\d{4}-0001 from inv Staffing — \$3,165\.00 due/);
    expect(mail.sent[0].attachments![0].content.subarray(0, 4).toString()).toBe('%PDF');
    expect(await db.invoice.findUnique({ where: { id: invId } })).toMatchObject({ status: 'SENT', sentTo: 'rita@harbor.test' });
    expect(await db.message.count({ where: { organizationId: org, relatedId: contact, status: 'sent' } })).toBe(1);
    const pdf = await PDF(req('GET'), P(invId));
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
  });

  it('takes partial payments, refuses overpayment, and settles', async () => {
    const pay = (amount: number, extra = {}) => PAY(req('POST', { amount, receivedOn: '2026-09-25', method: 'check', reference: '1042', ...extra }), P(invId));
    expect((await (await pay(1000, { method: 'barter' })).json()).error).toBe('Choose how it was paid.');
    expect((await pay(1000)).status).toBe(201);
    expect(await db.invoice.findUnique({ where: { id: invId } })).toMatchObject({ status: 'PARTIAL' });
    expect((await (await pay(2165.01)).json()).error).toMatch(/^That’s more than the \$2,165\.00 still owed/);
    const last = await (await pay(2165)).json();
    const paid = await db.invoice.findUnique({ where: { id: invId } });
    expect([paid!.status, Number(paid!.amountPaid), !!paid!.paidAt]).toEqual(['PAID', 3165, true]);
    expect((await (await VOID(req('PATCH', { action: 'void', reason: 'oops' }), P(invId))).json()).error).toBe('Remove its payments before voiding this invoice.');
    expect((await UNPAY(req('DELETE'), { params: { id: invId, pid: last.id } })).status).toBe(200);
    expect(await db.invoice.findUnique({ where: { id: invId } })).toMatchObject({ status: 'PARTIAL', paidAt: null });
    expect(await db.auditLog.count({ where: { organizationId: org, action: { in: ['billing.payment', 'billing.payment_delete'] } } })).toBe(3);
  });

  it('ages what’s owed, and voiding frees the hours to bill again', async () => {
    await db.invoice.update({ where: { id: invId }, data: { dueDate: new Date(Date.now() - 45 * 864e5) } });
    const csv = await (await AGING()).text();
    expect(csv.split('\r\n')[1]).toBe('Harbor Point,0.00,0.00,2165.00,0.00,0.00,2165.00,45');
    const pays = await db.payment.findMany({ where: { invoiceId: invId } });
    for (const p of pays) await UNPAY(req('DELETE'), { params: { id: invId, pid: p.id } });
    expect((await VOID(req('PATCH', { action: 'void', reason: 'wrong bill rate' }), P(invId))).status).toBe(200);
    const again = await CREATE(req('POST', { clientId: client, from: PREV, to: WEEK }));
    expect(again.status).toBe(201);
    expect((await db.invoice.findUnique({ where: { id: (await again.json()).id } }))!.number).toMatch(/-0002$/);
  });
});

describe('clients with invoices', () => {
  it('can’t be deleted one by one, but the whole company can be', async () => {
    as(admin);
    const r = await DELETE_RECORD(req('DELETE'), { params: { kind: 'clients', id: client } });
    expect([r.status, (await r.json()).error]).toEqual([409, 'This client has invoices, so it can’t be deleted (they’re financial records). Set its status to Inactive instead.']);
    const tmp = await db.organization.create({ data: { name: 'Tmp', slug: `tmp-${RUN}` } });
    const c = await db.client.create({ data: { organizationId: tmp.id, name: 'C' } });
    await db.invoice.create({ data: { organizationId: tmp.id, clientId: c.id, number: 'INV-1', issueDate: new Date(), dueDate: new Date(), periodStart: new Date(), periodEnd: new Date(), terms: 'Net 30', total: 1 } });
    await db.organization.delete({ where: { id: tmp.id } });
    expect(await db.invoice.count({ where: { organizationId: tmp.id } })).toBe(0);
  });
});

describe('schedule → timesheets', () => {
  it('fills blanks only, and never over typed, approved or clocked hours', async () => {
    const week = '2026-10-04', mon = (d: number) => new Date(Date.parse('2026-09-28T00:00:00Z') + d * 864e5);
    const job = await db.job.findFirst({ where: { organizationId: org } });
    const c = await db.candidate.create({ data: { organizationId: org, name: 'Cam Night' } });
    const appC = (await db.application.create({ data: { organizationId: org, candidateId: c.id, jobId: job!.id, stage: 'PLACED' } })).id;
    const shift = (applicationId: string, d: number, extra = {}) => db.shift.create({ data: { organizationId: org, applicationId, date: mon(d), start: '07:00', end: '17:30', breakMinutes: 30, ...extra } });
    for (let d = 0; d < 5; d++) await shift(appA, d);           // 50h → 40 + 10 OT
    await shift(appA, 5, { cancelled: true });                   // not counted
    await shift(appA, 6, { response: 'DECLINED' });              // not counted
    await shift(appB, 0);                                        // B already typed hours
    await ts(appB, week, 12, 0, 'DRAFT');
    await shift(appC, 0);                                        // C clocked in
    await db.timeEntry.create({ data: { organizationId: org, applicationId: appC, clockIn: new Date('2026-09-28T11:00:00Z'), clockOut: new Date('2026-09-28T19:00:00Z') } });
    as(rec);
    const r = await (await FILL(req('POST', { week }))).json();
    expect(r).toMatchObject({ filled: 1, kept: ['Ben Cole'], clocked: ['Cam Night'] });
    const a = await db.timesheet.findFirst({ where: { applicationId: appA, weekEnding: new Date(`${week}T00:00:00Z`) } });
    expect([Number(a!.regularHours), Number(a!.overtimeHours), a!.status, Number(a!.billRate)]).toEqual([40, 10, 'DRAFT', 30]);
    expect(Number((await db.timesheet.findFirst({ where: { applicationId: appB, weekEnding: new Date(`${week}T00:00:00Z`) } }))!.regularHours)).toBe(12);
    expect((await (await FILL(req('POST', { week }))).json()).filled).toBe(0); // second run changes nothing
    expect((await (await FILL(req('POST', { week: '2026-10-01' }))).json()).error).toBe('Week ending must be a Sunday');
  });
});
