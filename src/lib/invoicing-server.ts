import { z } from 'zod';
import type { Invoice, InvoiceLine, Organization, Payment, User } from '@prisma/client';
import { HttpError, logActivity, type TenantDb } from './tenant';
import { sendEmail } from './email';
import { renderInvoicePdf } from './pdf';
import { audit } from './audit';
import { fetchLogo } from './logo-fetch';
import { ITEM_KINDS, PAYMENT_METHODS, addDays, fromCents, invoiceTotals, itemCents, lineCents, statusFor, termsDays, toCents, usd, type ItemKind } from './invoicing';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.');

const Money = (msg: string) => z.number({ invalid_type_error: msg, required_error: msg }).finite(msg);
export const ItemBody = z.object({
  kind: z.enum(Object.keys(ITEM_KINDS) as [ItemKind, ...ItemKind[]], { errorMap: () => ({ message: 'Choose the kind of item.' }) }),
  description: z.string().trim().min(1, 'Describe each additional item.').max(200, 'Keep item descriptions under 200 characters.'),
  quantity: Money('Enter a quantity for each item.').positive('Quantities must be more than zero.').max(100000),
  rate: Money('Enter an amount for each item.').min(0, 'Enter item amounts as positive numbers; choose “Discount or credit” to take money off.').max(1_000_000),
});
/** What can be set on an invoice before it goes out: who it's addressed to, the PO, tax, notes and extra items. */
export const DetailsBody = z.object({
  poNumber: z.string().trim().max(60, 'Keep the PO number under 60 characters.').optional(),
  billToName: z.string().trim().max(120).optional(),
  billToAddress: z.string().trim().max(400, 'Keep the billing address under 400 characters.').optional(),
  notes: z.string().trim().max(1000, 'Keep the note under 1,000 characters.').optional(),
  taxRatePct: z.number({ invalid_type_error: 'Enter the tax rate as a number.' }).min(0, 'The tax rate can’t be negative.').max(25, 'That tax rate looks too high — enter it as a percent, like 6.25.').optional(),
  items: z.array(ItemBody).max(50, 'An invoice can have up to 50 additional items.').optional(),
});
export const CreateBody = DetailsBody.extend({
  clientId: z.string().min(1, 'Choose a client.'),
  from: Day, to: Day,
  payrollRunId: z.string().optional(),
  /** Weeks of hours left off this invoice (they stay billable for a later one). */
  excludeTimesheetIds: z.array(z.string()).max(2000).optional(),
  /** Keep this PO, address, tax rate and "Attn" contact as the client's defaults for next time. */
  saveDefaults: z.boolean().optional(),
}).refine((b) => b.from <= b.to, { message: 'The period’s start is after its end.' });
type Details = z.infer<typeof DetailsBody>;

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

const approval = (t: { clientApprovedBy: string | null; clientApprovedAt: Date | null }) =>
  t.clientApprovedAt ? `Approved by ${t.clientApprovedBy || 'client'} ${t.clientApprovedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` : null;
type Billable = Awaited<ReturnType<typeof billable>>[number];
const hoursLine = (t: Billable) => {
  const reg = Number(t.regularHours), ot = Number(t.overtimeHours), rate = Number(t.billRate);
  return { timesheetId: t.id, worker: t.application.candidate.name, description: t.application.job.title, weekEnding: t.weekEnding, regularHours: reg, overtimeHours: ot, rate, cents: lineCents(reg, ot, rate), approvedBy: approval(t) };
};
const itemLines = (items: Details['items'] = []) => items.map((it, i) => ({ kind: it.kind, worker: '', description: it.description, quantity: it.quantity, rate: it.rate, cents: itemCents(it.kind, it.quantity, it.rate), sortOrder: 1000 + i }));
function totalsOrThrow(labor: number, items: ReturnType<typeof itemLines>, taxRatePct: number) {
  const t = invoiceTotals(labor, items.map((i) => i.cents), taxRatePct);
  if (t.subtotal < 0) throw new HttpError(400, `The discounts (${usd(t.discounts)}) are more than the invoice (${usd(t.labor + t.extras)}).`);
  return t;
}

/** What a new invoice would hold, for the "New invoice" screen: the hours, the client's billing defaults and the due date. */
export async function previewInvoice(tdb: TenantDb, clientId: string, from: string, to: string) {
  const client = await tdb.client.findFirst({ where: { id: clientId }, include: { contacts: { orderBy: { name: 'asc' } } } });
  if (!client) throw new HttpError(404, 'That client was deleted.');
  const lines = (await billable(tdb, clientId, from, to)).map(hoursLine);
  const issue = ymd(new Date()), contact = client.contacts.find((c) => c.id === client.billingContactId);
  return {
    client: { id: client.id, name: client.name, terms: client.paymentTerms, due: addDays(issue, termsDays(client.paymentTerms)) },
    defaults: { poNumber: client.poNumber ?? '', billToName: contact?.name ?? '', billToAddress: client.billingAddress ?? '', taxRatePct: client.taxRatePct == null ? 0 : Number(client.taxRatePct) },
    contacts: client.contacts.map((c) => ({ id: c.id, name: c.name, title: c.title })),
    lines: lines.map((l) => ({ ...l, weekEnding: ymd(l.weekEnding), amount: l.cents / 100 })),
  };
}

/** Builds an invoice from approved hours plus any added items. Serialized per client so the same hours can't go on two invoices. */
export async function createInvoice(tdb: TenantDb, org: Organization, user: User, b: z.infer<typeof CreateBody>) {
  const client = await tdb.client.findFirst({ where: { id: b.clientId }, include: { contacts: { select: { id: true, name: true } } } });
  if (!client) throw new HttpError(404, 'That client was deleted.');
  const inv = await tdb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${org.id}:${client.id}`}))`;
    const skip = new Set(b.excludeTimesheetIds ?? []);
    const ts = (await billable(tx as unknown as TenantDb, client.id, b.from, b.to, b.payrollRunId)).filter((t) => !skip.has(t.id));
    if (!ts.length) throw new HttpError(409, skip.size ? 'Every week of hours was left off. Include at least one.' : `There are no approved hours for ${client.name} in that period that aren’t already invoiced.`);
    const lines = ts.map(hoursLine), items = itemLines(b.items);
    const taxRatePct = b.taxRatePct ?? (client.taxRatePct == null ? 0 : Number(client.taxRatePct));
    const t = totalsOrThrow(lines.reduce((s, l) => s + l.cents, 0), items, taxRatePct);
    const issue = ymd(new Date()), year = issue.slice(0, 4);
    const seq = (await tx.invoice.count({ where: { number: { startsWith: `INV-${year}-` } } })) + 1;
    const created = await tx.invoice.create({ data: {
      clientId: client.id, number: `INV-${year}-${String(seq).padStart(4, '0')}`, issueDate: new Date(`${issue}T00:00:00Z`),
      dueDate: new Date(`${addDays(issue, termsDays(client.paymentTerms))}T00:00:00Z`), terms: client.paymentTerms,
      periodStart: new Date(Math.max(ts[0].weekEnding.getTime() - 6 * 864e5, Date.parse(`${b.from}T00:00:00Z`))), // first billed week's Monday
      periodEnd: ts[ts.length - 1].weekEnding, notes: b.notes || null, payrollRunId: b.payrollRunId ?? null, createdById: user.id,
      poNumber: (b.poNumber ?? client.poNumber) || null,
      billToName: (b.billToName ?? client.contacts.find((c) => c.id === client.billingContactId)?.name) || null,
      billToAddress: (b.billToAddress ?? client.billingAddress) || null,
      subtotal: fromCents(t.subtotal), taxRatePct, taxAmount: fromCents(t.tax), total: fromCents(t.total),
    } as never });
    await tx.invoiceLine.createMany({ data: [
      ...lines.map(({ cents: c, ...l }, i) => ({ ...l, kind: 'hours', invoiceId: created.id, amount: fromCents(c), sortOrder: i })),
      ...items.map(({ cents: c, ...l }) => ({ ...l, invoiceId: created.id, amount: fromCents(c) })),
    ] as never });
    return created;
  });
  if (b.saveDefaults) {
    const contact = client.contacts.find((c) => c.name === b.billToName);
    await tdb.client.updateMany({ where: { id: client.id }, data: {
      ...(b.poNumber !== undefined ? { poNumber: b.poNumber || null } : {}), ...(b.billToAddress !== undefined ? { billingAddress: b.billToAddress || null } : {}),
      ...(b.taxRatePct !== undefined ? { taxRatePct: b.taxRatePct } : {}), ...(b.billToName !== undefined ? { billingContactId: contact?.id ?? null } : {}),
    } });
  }
  await logActivity(org.id, `Created invoice ${inv.number} for ${client.name}: ${usd(toCents(inv.total))}`, user.id);
  return inv;
}

/** Why a draft can no longer be changed, or null when it can. */
export function lockedReason(inv: { status: string; sentAt: Date | null; syncedAt: Date | null; payments: unknown[] }) {
  if (inv.status === 'VOID') return 'This invoice is void.';
  if (inv.sentAt) return 'This invoice was already emailed to the client, so it can’t be changed. Void it and make a new one.';
  if (inv.payments.length) return 'This invoice has payments, so it can’t be changed.';
  if (inv.syncedAt) return 'This invoice is already in your accounting system, so it can’t be changed here.';
  return null;
}

/** Changes a draft's details and additional items; the hours stay as they are. Totals are worked out again. */
export async function updateDraft(tdb: TenantDb, org: Organization, user: User, inv: Loaded, b: Details) {
  const why = lockedReason(inv);
  if (why) throw new HttpError(409, why);
  const hours = inv.lines.filter((l) => l.kind === 'hours');
  const items = b.items ? itemLines(b.items) : null;
  const keptItems = inv.lines.filter((l) => l.kind !== 'hours').map((l) => toCents(l.amount));
  const taxRatePct = b.taxRatePct ?? Number(inv.taxRatePct);
  const t = invoiceTotals(hours.reduce((s, l) => s + toCents(l.amount), 0), items ? items.map((i) => i.cents) : keptItems, taxRatePct);
  if (t.subtotal < 0) throw new HttpError(400, `The discounts (${usd(t.discounts)}) are more than the invoice (${usd(t.labor + t.extras)}).`);
  await tdb.$transaction(async (tx) => {
    if (items) {
      await tx.invoiceLine.deleteMany({ where: { invoiceId: inv.id, kind: { not: 'hours' } } });
      if (items.length) await tx.invoiceLine.createMany({ data: items.map(({ cents: c, ...l }) => ({ ...l, invoiceId: inv.id, amount: fromCents(c) })) as never });
    }
    await tx.invoice.updateMany({ where: { id: inv.id }, data: {
      ...(b.poNumber !== undefined ? { poNumber: b.poNumber || null } : {}), ...(b.billToName !== undefined ? { billToName: b.billToName || null } : {}),
      ...(b.billToAddress !== undefined ? { billToAddress: b.billToAddress || null } : {}), ...(b.notes !== undefined ? { notes: b.notes || null } : {}),
      taxRatePct, subtotal: fromCents(t.subtotal), taxAmount: fromCents(t.tax), total: fromCents(t.total),
    } });
  });
  await logActivity(org.id, `Updated draft invoice ${inv.number} (${inv.client.name}): now ${usd(t.total)}`, user.id);
}

export async function loadInvoice(tdb: TenantDb, id: string) {
  const inv = await tdb.invoice.findFirst({ where: { id }, include: { client: { include: { contacts: { orderBy: { name: 'asc' } } } }, lines: { orderBy: [{ sortOrder: 'asc' }, { weekEnding: 'asc' }, { worker: 'asc' }] }, payments: { orderBy: { receivedOn: 'asc' } } } });
  if (!inv) throw new HttpError(404, 'That invoice was deleted.');
  return inv;
}
type Loaded = Awaited<ReturnType<typeof loadInvoice>>;

export const balanceCents = (inv: Pick<Invoice, 'total' | 'amountPaid'>) => toCents(inv.total) - toCents(inv.amountPaid);

const fmtDay = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
type PdfInvoice = Invoice & { client: { name: string; city: string | null }; lines: InvoiceLine[]; payments?: Payment[] };

/** Money on an invoice, in cents: services (hours), added items, and the stored subtotal, tax and total. */
export function invoiceSummary(inv: Pick<Invoice, 'total' | 'amountPaid' | 'subtotal' | 'taxAmount' | 'taxRatePct'> & { lines: Pick<InvoiceLine, 'kind' | 'amount' | 'regularHours' | 'overtimeHours' | 'worker'>[] }) {
  const hours = inv.lines.filter((l) => l.kind === 'hours'), items = inv.lines.filter((l) => l.kind !== 'hours');
  const total = toCents(inv.total), paid = toCents(inv.amountPaid), tax = toCents(inv.taxAmount);
  return {
    labor: hours.reduce((s, l) => s + toCents(l.amount), 0), extras: items.filter((l) => Number(l.amount) > 0).reduce((s, l) => s + toCents(l.amount), 0),
    discounts: -items.filter((l) => Number(l.amount) < 0).reduce((s, l) => s + toCents(l.amount), 0),
    subtotal: toCents(inv.subtotal) || total - tax, tax, taxRatePct: Number(inv.taxRatePct), total, paid, balance: total - paid,
    workers: new Set(hours.map((l) => l.worker)).size, regular: hours.reduce((s, l) => s + Number(l.regularHours), 0), overtime: hours.reduce((s, l) => s + Number(l.overtimeHours), 0),
  };
}

export async function invoicePdf(org: Organization, inv: PdfInvoice) {
  const t = invoiceSummary(inv);
  return renderInvoicePdf({
    number: inv.number, company: org.name, city: org.city, client: inv.client.name, clientCity: inv.client.city, terms: inv.terms, status: inv.status,
    weekEnding: fmtDay(inv.periodEnd), period: `${fmtDay(inv.periodStart)} - ${fmtDay(inv.periodEnd)}`, due: fmtDay(inv.dueDate), issued: fmtDay(inv.issueDate), poNumber: inv.poNumber,
    from: { address: org.billingAddress ?? org.city, phone: org.billingPhone, email: org.billingEmail, website: org.website, taxId: org.taxId },
    billTo: { name: inv.billToName, address: inv.billToAddress ?? inv.client.city },
    lines: inv.lines.filter((l) => l.kind === 'hours').map((l) => ({ worker: l.worker, position: l.description, week: l.weekEnding ? fmtDay(l.weekEnding) : null, reg: Number(l.regularHours), ot: Number(l.overtimeHours), rate: Number(l.rate), amount: Number(l.amount), approvedBy: l.approvedBy })),
    items: inv.lines.filter((l) => l.kind !== 'hours').map((l) => ({ kind: l.kind, description: l.description, qty: Number(l.quantity ?? 1), rate: Number(l.rate), amount: Number(l.amount) })),
    totals: { subtotal: t.subtotal / 100, taxRatePct: t.taxRatePct, tax: t.tax / 100, total: t.total / 100, paid: t.paid / 100, balance: t.balance / 100 },
    notes: inv.notes, remit: org.remitInstructions, footer: org.invoiceFooter, brandColor: org.brandColor, logo: await fetchLogo(org.logoUrl),
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
  contactIds: z.array(z.string()).max(10),
  /** Also send to the client's accounts-payable address. */
  billingEmail: z.boolean().optional(),
  message: z.string().trim().max(2000).optional(),
}).refine((b) => b.contactIds.length || b.billingEmail, { message: 'Choose who gets the invoice.' });

/** Emails the PDF to the chosen client contacts (one email each) and logs every attempt. */
export async function sendInvoice(tdb: TenantDb, org: Organization, user: User, inv: Loaded, b: z.infer<typeof SendBody>) {
  if (inv.status === 'VOID') throw new HttpError(409, 'This invoice is void.');
  const to: { id: string; name: string; email: string | null; type: string }[] = inv.client.contacts.filter((c) => b.contactIds.includes(c.id)).map((c) => ({ ...c, type: 'contact' }));
  if (b.billingEmail) {
    if (!inv.client.billingEmail) throw new HttpError(400, `${inv.client.name} has no accounts payable email. Add one on the client record.`);
    if (!to.some((c) => c.email?.toLowerCase() === inv.client.billingEmail!.toLowerCase())) to.push({ id: inv.client.id, name: 'Accounts Payable', email: inv.client.billingEmail, type: 'client' });
  }
  if (!to.length) throw new HttpError(404, `Choose a contact at ${inv.client.name}.`);
  const noEmail = to.filter((c) => !c.email);
  if (noEmail.length) throw new HttpError(400, `${noEmail.map((c) => c.name).join(', ')} ${noEmail.length === 1 ? 'has' : 'have'} no email address.`);
  const pdf = Buffer.from(await invoicePdf(org, inv));
  const company = org.shortName ?? org.name, bal = usd(balanceCents(inv)), t = invoiceSummary(inv);
  const subject = `Invoice ${inv.number} from ${company}${inv.poNumber ? ` (PO ${inv.poNumber})` : ''} — ${bal} due ${fmtDay(inv.dueDate)}`;
  const sent: string[] = [], failed: string[] = [];
  for (const c of to) {
    const text = [
      `Hi ${c.type === 'client' ? `${inv.client.name} Accounts Payable` : c.name.split(' ')[0] || 'there'},`, '',
      ...(b.message ? [b.message, ''] : []),
      `Attached is invoice ${inv.number} for staffing services from ${fmtDay(inv.periodStart)} to ${fmtDay(inv.periodEnd)}.`, '',
      `Invoice: ${inv.number}`, ...(inv.poNumber ? [`PO number: ${inv.poNumber}`] : []),
      `Services: ${t.workers} worker${t.workers === 1 ? '' : 's'}, ${t.regular.toFixed(2)} regular and ${t.overtime.toFixed(2)} overtime hours`,
      ...(t.extras || t.discounts ? [`Additional items: ${usd(t.extras)}${t.discounts ? `, discounts ${usd(-t.discounts)}` : ''}`] : []),
      ...(t.tax ? [`Sales tax: ${usd(t.tax)}`] : []),
      `Amount due: ${bal}`, `Due date: ${fmtDay(inv.dueDate)} (${inv.terms})`,
      ...(org.remitInstructions ? ['', 'How to pay:', org.remitInstructions] : []), '',
      'Reply to this email with any questions.', '', 'Thank you,', user.name ?? '', company,
    ].join('\n');
    try {
      const r = await sendEmail({ to: c.email!, subject, text, replyTo: user.email, fromName: company, attachments: [{ filename: `${inv.number}.pdf`, content: pdf }] });
      await tdb.message.create({ data: { channel: 'email', toAddress: c.email!, subject, body: text, relatedType: c.type, relatedId: c.id, status: 'sent', providerId: r.id, sentById: user.id } as never });
      sent.push(c.email!);
    } catch (e) {
      await tdb.message.create({ data: { channel: 'email', toAddress: c.email!, subject, body: text, relatedType: c.type, relatedId: c.id, status: 'failed', error: String((e as Error).message).slice(0, 300), sentById: user.id } as never });
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
