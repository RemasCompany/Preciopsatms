import { z } from 'zod';
import type { Invoice, InvoiceLine, Organization, Payment, User } from '@prisma/client';
import { HttpError, logActivity, type TenantDb } from './tenant';
import { sendEmail } from './email';
import { renderInvoicePdf } from './pdf';
import { audit } from './audit';
import { PAYMENT_METHODS, addDays, fromCents, lineCents, statusFor, termsDays, toCents, usd } from './invoicing';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.');

export const CreateBody = z.object({
  clientId: z.string().min(1, 'Choose a client.'),
  from: Day, to: Day,
  payrollRunId: z.string().optional(),
  notes: z.string().trim().max(1000).optional(),
}).refine((b) => b.from <= b.to, { message: 'The period’s start is after its end.' });

/** Approved or paid timesheets for a client whose week ends in [from, to] and that aren't on a live invoice yet. */
export async function billable(tdb: TenantDb, clientId: string, from: string, to: string, payrollRunId?: string) {
  const ts = await tdb.timesheet.findMany({
    where: { status: { in: ['APPROVED', 'PAID'] }, weekEnding: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }, application: { job: { clientId } }, ...(payrollRunId ? { payrollRunId } : {}) },
    include: { application: { include: { candidate: { select: { name: true } }, job: { select: { title: true } } } } }, orderBy: [{ weekEnding: 'asc' }],
  });
  if (!ts.length) return [];
  const billed = new Set((await tdb.invoiceLine.findMany({ where: { timesheetId: { in: ts.map((t) => t.id) }, invoice: { status: { not: 'VOID' } } }, select: { timesheetId: true } })).map((l) => l.timesheetId));
  return ts.filter((t) => !billed.has(t.id) && Number(t.regularHours) + Number(t.overtimeHours) > 0);
}

/** Builds an invoice from approved hours. Serialized per client so the same hours can't go on two invoices. */
export async function createInvoice(tdb: TenantDb, org: Organization, user: User, b: z.infer<typeof CreateBody>) {
  const client = await tdb.client.findFirst({ where: { id: b.clientId } });
  if (!client) throw new HttpError(404, 'That client was deleted.');
  const inv = await tdb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${org.id}:${client.id}`}))`;
    const ts = await billable(tx as unknown as TenantDb, client.id, b.from, b.to, b.payrollRunId);
    if (!ts.length) throw new HttpError(409, `There are no approved hours for ${client.name} in that period that aren’t already invoiced.`);
    const lines = ts.map((t) => {
      const reg = Number(t.regularHours), ot = Number(t.overtimeHours), rate = Number(t.billRate);
      return { timesheetId: t.id, worker: t.application.candidate.name, description: t.application.job.title, weekEnding: t.weekEnding, regularHours: reg, overtimeHours: ot, rate, cents: lineCents(reg, ot, rate) };
    });
    const total = lines.reduce((s, l) => s + l.cents, 0);
    const issue = ymd(new Date()), year = issue.slice(0, 4);
    const seq = (await tx.invoice.count({ where: { number: { startsWith: `INV-${year}-` } } })) + 1;
    const created = await tx.invoice.create({ data: {
      clientId: client.id, number: `INV-${year}-${String(seq).padStart(4, '0')}`, issueDate: new Date(`${issue}T00:00:00Z`),
      dueDate: new Date(`${addDays(issue, termsDays(client.paymentTerms))}T00:00:00Z`), terms: client.paymentTerms,
      periodStart: new Date(Math.max(ts[0].weekEnding.getTime() - 6 * 864e5, Date.parse(`${b.from}T00:00:00Z`))), // first billed week's Monday
      periodEnd: ts[ts.length - 1].weekEnding, total: fromCents(total), notes: b.notes || null, payrollRunId: b.payrollRunId ?? null, createdById: user.id,
    } as never });
    await tx.invoiceLine.createMany({ data: lines.map(({ cents, ...l }) => ({ ...l, invoiceId: created.id, amount: fromCents(cents) })) as never });
    return created;
  });
  await logActivity(org.id, `Created invoice ${inv.number} for ${client.name}: ${usd(toCents(inv.total))}`, user.id);
  return inv;
}

export async function loadInvoice(tdb: TenantDb, id: string) {
  const inv = await tdb.invoice.findFirst({ where: { id }, include: { client: { include: { contacts: { orderBy: { name: 'asc' } } } }, lines: { orderBy: [{ weekEnding: 'asc' }, { worker: 'asc' }] }, payments: { orderBy: { receivedOn: 'asc' } } } });
  if (!inv) throw new HttpError(404, 'That invoice was deleted.');
  return inv;
}
type Loaded = Awaited<ReturnType<typeof loadInvoice>>;

export const balanceCents = (inv: Pick<Invoice, 'total' | 'amountPaid'>) => toCents(inv.total) - toCents(inv.amountPaid);

export function invoicePdf(org: Organization, inv: Invoice & { client: { name: string; city: string | null }; lines: InvoiceLine[]; payments?: Payment[] }) {
  return renderInvoicePdf({
    number: inv.number, company: org.name, city: org.city, client: inv.client.name, clientCity: inv.client.city, terms: inv.terms,
    weekEnding: ymd(inv.periodEnd), period: `${ymd(inv.periodStart)} to ${ymd(inv.periodEnd)}`, due: ymd(inv.dueDate),
    lines: inv.lines.map((l) => ({ worker: l.worker, position: l.weekEnding ? `${l.description} (wk ${ymd(l.weekEnding).slice(5)})` : l.description, reg: Number(l.regularHours), ot: Number(l.overtimeHours), rate: Number(l.rate), amount: Number(l.amount) })),
  });
}

/** Recomputes paid amount and status from the payments (the source of truth). */
async function settle(tdb: TenantDb, id: string) {
  const inv = await tdb.invoice.findFirst({ where: { id }, include: { payments: true } });
  if (!inv) return;
  const paid = inv.payments.reduce((s, p) => s + toCents(p.amount), 0), total = toCents(inv.total);
  const status = statusFor(total, paid, !!inv.sentAt, inv.status === 'VOID');
  await tdb.invoice.updateMany({ where: { id }, data: { amountPaid: fromCents(paid), status, paidAt: status === 'PAID' ? inv.paidAt ?? new Date() : null } });
}

export const SendBody = z.object({
  contactIds: z.array(z.string()).min(1, 'Choose who gets the invoice.').max(10),
  message: z.string().trim().max(2000).optional(),
});

/** Emails the PDF to the chosen client contacts (one email each) and logs every attempt. */
export async function sendInvoice(tdb: TenantDb, org: Organization, user: User, inv: Loaded, b: z.infer<typeof SendBody>) {
  if (inv.status === 'VOID') throw new HttpError(409, 'This invoice is void.');
  const to = inv.client.contacts.filter((c) => b.contactIds.includes(c.id));
  if (!to.length) throw new HttpError(404, `Choose a contact at ${inv.client.name}.`);
  const noEmail = to.filter((c) => !c.email);
  if (noEmail.length) throw new HttpError(400, `${noEmail.map((c) => c.name).join(', ')} ${noEmail.length === 1 ? 'has' : 'have'} no email address.`);
  const pdf = Buffer.from(await invoicePdf(org, inv));
  const company = org.shortName ?? org.name, bal = usd(balanceCents(inv));
  const subject = `Invoice ${inv.number} from ${company} — ${bal} due ${ymd(inv.dueDate)}`;
  const sent: string[] = [], failed: string[] = [];
  for (const c of to) {
    const text = `Hi ${c.name.split(' ')[0] || 'there'},\n\n${b.message ? `${b.message}\n\n` : ''}Attached is invoice ${inv.number} for staffing services ${ymd(inv.periodStart)} to ${ymd(inv.periodEnd)}.\n\nAmount due: ${bal}\nDue date: ${ymd(inv.dueDate)} (${inv.terms})\n\nReply to this email with any questions.\n\nThank you,\n${user.name ?? ''}\n${company}`;
    try {
      const r = await sendEmail({ to: c.email!, subject, text, replyTo: user.email, fromName: company, attachments: [{ filename: `${inv.number}.pdf`, content: pdf }] });
      await tdb.message.create({ data: { channel: 'email', toAddress: c.email!, subject, body: text, relatedType: 'contact', relatedId: c.id, status: 'sent', providerId: r.id, sentById: user.id } as never });
      sent.push(c.email!);
    } catch (e) {
      await tdb.message.create({ data: { channel: 'email', toAddress: c.email!, subject, body: text, relatedType: 'contact', relatedId: c.id, status: 'failed', error: String((e as Error).message).slice(0, 300), sentById: user.id } as never });
      failed.push(c.name);
    }
  }
  if (sent.length) {
    await tdb.invoice.updateMany({ where: { id: inv.id }, data: { sentAt: new Date(), sentTo: sent.join(', ') } });
    await settle(tdb, inv.id);
    await logActivity(org.id, `Emailed invoice ${inv.number} to ${sent.join(', ')}`, user.id);
  }
  return { sent, failed };
}

export const PaymentBody = z.object({
  amount: z.number({ invalid_type_error: 'Enter the amount received.', required_error: 'Enter the amount received.' }).positive('Enter the amount received.').max(10_000_000),
  receivedOn: Day,
  method: z.enum(Object.keys(PAYMENT_METHODS) as [keyof typeof PAYMENT_METHODS], { errorMap: () => ({ message: 'Choose how it was paid.' }) }),
  reference: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function recordPayment(tdb: TenantDb, org: Organization, user: User, inv: Loaded, b: z.infer<typeof PaymentBody>) {
  if (inv.status === 'VOID') throw new HttpError(409, 'This invoice is void, so it can’t take payments.');
  const cents = Math.round(b.amount * 100), bal = balanceCents(inv);
  if (cents > bal) throw new HttpError(400, `That’s more than the ${usd(bal)} still owed on ${inv.number}.`);
  if (b.receivedOn > ymd(new Date(Date.now() + 864e5))) throw new HttpError(400, 'The payment date is in the future.');
  const p = await tdb.payment.create({ data: { invoiceId: inv.id, amount: fromCents(cents), receivedOn: new Date(`${b.receivedOn}T00:00:00Z`), method: b.method, reference: b.reference || null, notes: b.notes || null, createdById: user.id } as never });
  await settle(tdb, inv.id);
  const text = `Recorded a ${usd(cents)} ${PAYMENT_METHODS[b.method].toLowerCase()} payment on ${inv.number} (${inv.client.name})${b.reference ? `, ref ${b.reference}` : ''}`;
  await logActivity(org.id, text, user.id);
  await audit(org.id, user, 'billing.payment', text, { targetType: 'invoice', targetId: inv.id });
  return p;
}

export async function deletePayment(tdb: TenantDb, org: Organization, user: User, invoiceId: string, paymentId: string) {
  const p = await tdb.payment.findFirst({ where: { id: paymentId, invoiceId }, include: { invoice: { select: { number: true } } } });
  if (!p) throw new HttpError(404, 'That payment was already removed.');
  await tdb.payment.deleteMany({ where: { id: p.id } });
  await settle(tdb, invoiceId);
  const text = `Removed a ${usd(toCents(p.amount))} payment from ${p.invoice.number} (received ${ymd(p.receivedOn)})`;
  await logActivity(org.id, text, user.id);
  await audit(org.id, user, 'billing.payment_delete', text, { targetType: 'invoice', targetId: invoiceId });
}

/** Voids an invoice with no payments; its hours become billable again. */
export async function voidInvoice(tdb: TenantDb, org: Organization, user: User, inv: Loaded, reason: string) {
  if (inv.status === 'VOID') throw new HttpError(409, 'This invoice is already void.');
  if (inv.payments.length) throw new HttpError(409, 'Remove its payments before voiding this invoice.');
  await tdb.invoice.updateMany({ where: { id: inv.id }, data: { status: 'VOID', voidedAt: new Date(), voidReason: reason } });
  const text = `Voided invoice ${inv.number} (${inv.client.name}, ${usd(toCents(inv.total))}): ${reason}`;
  await logActivity(org.id, text, user.id);
  await audit(org.id, user, 'billing.invoice_void', text, { targetType: 'invoice', targetId: inv.id });
}

/** Invoices with money still owed, shaped for aging. */
export async function openInvoices(tdb: TenantDb) {
  const inv = await tdb.invoice.findMany({ where: { status: { in: ['DRAFT', 'SENT', 'PARTIAL'] } }, include: { client: { select: { name: true } } } });
  return inv.map((i) => ({ id: i.id, number: i.number, clientId: i.clientId, client: i.client.name, dueDate: ymd(i.dueDate), balanceCents: balanceCents(i) }));
}
