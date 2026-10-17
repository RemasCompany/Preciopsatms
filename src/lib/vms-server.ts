import { z } from 'zod';
import { Prisma, type Organization, type User, type VmsProgram } from '@prisma/client';
import { HttpError, logActivity, type TenantDb } from './tenant';
import { audit } from './audit';
import { loadInvoice, recordPayment } from './invoicing-server';
import { VMS, feeFor, readRemittance, readRequisitions, timeFile, isVms, REQ_FIELDS, REMIT_FIELDS, TIME_FIELDS, type Mappings, type TimeRow, type VmsKind } from './vms';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const toCents = (v: unknown) => Math.round(Number(v) * 100);

const col = z.string().trim().max(80);
export const MappingBody = z.object({
  requisitions: z.record(z.enum(Object.keys(REQ_FIELDS) as [string]), col).optional(),
  remittance: z.record(z.enum(Object.keys(REMIT_FIELDS) as [string]), col).optional(),
  time: z.record(z.enum(Object.keys(TIME_FIELDS) as [string]), col).optional(),
});
export const ProgramBody = z.object({
  clientId: z.string().min(1, 'Choose the client.'),
  vms: z.enum(Object.keys(VMS) as [VmsKind], { errorMap: () => ({ message: 'Choose the VMS.' }) }),
  name: z.string().trim().min(1, 'Name the program.').max(80),
  supplierCode: z.string().trim().max(40).optional().nullable(),
  feePct: z.coerce.number({ invalid_type_error: 'Enter the VMS fee as a percent.' }).min(0, 'The fee can’t be negative.').max(20, 'VMS fees are usually 1–5%. Enter a percent up to 20.').default(0),
  rateCodes: z.object({ regular: z.string().trim().max(20).optional(), overtime: z.string().trim().max(20).optional() }).optional().nullable(),
});
export const ProgramPatch = ProgramBody.partial().extend({ mappings: MappingBody.optional() });

export function programView(p: VmsProgram & { client?: { name: string } | null; _count?: { jobs: number } }) {
  const preset = isVms(p.vms) ? VMS[p.vms] : VMS.other;
  return {
    id: p.id, clientId: p.clientId, clientName: p.client?.name ?? null, vms: p.vms, vmsLabel: preset.label, idLabel: preset.idLabel, workerIdLabel: preset.workerIdLabel, hint: preset.hint,
    name: p.name, supplierCode: p.supplierCode, feePct: Number(p.feePct), mappings: (p.mappings as Mappings | null) ?? {}, rateCodes: { ...preset.rateCodes, ...((p.rateCodes as object | null) ?? {}) },
    timeColumns: preset.time.map(([f, h]) => ({ field: f, label: TIME_FIELDS[f], header: ((p.mappings as Mappings | null)?.time?.[f]) || h })),
    jobs: p._count?.jobs ?? 0, lastImportAt: p.lastImportAt?.toISOString() ?? null,
  };
}

export async function getProgram(tdb: TenantDb, id: string) {
  const p = await tdb.vmsProgram.findFirst({ where: { id }, include: { client: { select: { name: true } } } });
  if (!p) throw new HttpError(404, 'That VMS program was deleted.');
  return p;
}

export async function createProgram(tdb: TenantDb, org: Organization, user: User, b: z.infer<typeof ProgramBody>) {
  const client = await tdb.client.findFirst({ where: { id: b.clientId }, select: { name: true } });
  if (!client) throw new HttpError(400, 'That client was deleted.');
  const p = await tdb.vmsProgram.create({ data: { clientId: b.clientId, vms: b.vms, name: b.name, supplierCode: b.supplierCode || null, feePct: new Prisma.Decimal(b.feePct), rateCodes: b.rateCodes ?? undefined, createdById: user.id } as never });
  await audit(org.id, user, 'vms.program', `Added the ${VMS[b.vms].label} program “${b.name}” for ${client.name}`, { targetType: 'vmsProgram', targetId: p.id });
  return p;
}

export async function updateProgram(tdb: TenantDb, org: Organization, user: User, p: VmsProgram, b: z.infer<typeof ProgramPatch>) {
  if (b.clientId && !(await tdb.client.findFirst({ where: { id: b.clientId }, select: { id: true } }))) throw new HttpError(400, 'That client was deleted.');
  const old = (p.mappings as Mappings | null) ?? {};
  const data: Record<string, unknown> = {};
  if (b.clientId) data.clientId = b.clientId;
  if (b.vms) data.vms = b.vms;
  if (b.name) data.name = b.name;
  if (b.supplierCode !== undefined) data.supplierCode = b.supplierCode || null;
  if (b.feePct !== undefined) data.feePct = new Prisma.Decimal(b.feePct);
  if (b.rateCodes !== undefined) data.rateCodes = b.rateCodes ?? Prisma.DbNull;
  if (b.mappings) data.mappings = { ...old, ...b.mappings };
  await tdb.vmsProgram.updateMany({ where: { id: p.id }, data });
  await audit(org.id, user, 'vms.program', `Changed the VMS program “${b.name ?? p.name}”`, { targetType: 'vmsProgram', targetId: p.id });
}

// ---- requisitions ----
type Action = 'new' | 'update' | 'same' | 'skip';

/** What importing this file would do, row by row. */
export async function planRequisitions(tdb: TenantDb, p: VmsProgram, text: string, mapping?: Mappings['requisitions']) {
  const kind = (isVms(p.vms) ? p.vms : 'other') as VmsKind;
  const read = readRequisitions(text, kind, mapping ?? ((p.mappings as Mappings | null)?.requisitions ?? {}));
  const ids = [...new Set(read.rows.map((r) => r.reqId).filter(Boolean))];
  const existing = ids.length ? await tdb.job.findMany({ where: { vmsProgramId: p.id, vmsReqId: { in: ids } } }) : [];
  const seen = new Set<string>();
  const rows = read.rows.map((r) => {
    let action: Action = 'new';
    const changes: string[] = [];
    const job = existing.find((j) => j.vmsReqId === r.reqId);
    if (r.problems.length) action = 'skip';
    else if (seen.has(r.reqId)) { action = 'skip'; r.problems.push('Same requisition ID as an earlier row.'); }
    else if (job) {
      if (r.title !== job.title) changes.push('title');
      if (r.openings !== null && r.openings !== job.openings) changes.push('positions');
      if (r.billRate !== null && toCents(r.billRate) !== toCents(job.billRate ?? -1)) changes.push('bill rate');
      if (r.payRate !== null && toCents(r.payRate) !== toCents(job.payRate ?? -1)) changes.push('pay rate');
      if (r.location && r.location !== job.location) changes.push('location');
      if (r.startDate && r.startDate !== (job.startDate ? ymd(job.startDate) : null)) changes.push('start date');
      if (r.status && r.status !== job.status) changes.push('status');
      action = changes.length ? 'update' : 'same';
    }
    if (r.reqId) seen.add(r.reqId);
    return { ...r, action, changes, jobId: job?.id ?? null };
  });
  return { headers: read.headers, columns: read.columns, missing: read.missing, truncated: read.truncated, rows, counts: count(rows) };
}
const count = (rows: { action: Action }[]) => ({ new: rows.filter((r) => r.action === 'new').length, update: rows.filter((r) => r.action === 'update').length, same: rows.filter((r) => r.action === 'same').length, skip: rows.filter((r) => r.action === 'skip').length });

/** Adds new requisitions as jobs for the program's client (not published: VMS programs don't allow public postings) and updates changed ones. */
export async function importRequisitions(tdb: TenantDb, org: Organization, user: User, p: VmsProgram, text: string, mapping?: Mappings['requisitions']) {
  const plan = await planRequisitions(tdb, p, text, mapping);
  if (plan.missing.length) throw new HttpError(400, `Choose the column for: ${plan.missing.join(', ')}.`);
  await tdb.$transaction(async (tx) => {
    for (const r of plan.rows) {
      const notes = [r.manager && `Hiring manager: ${r.manager}`, r.endDate && `Requested end date: ${r.endDate}`].filter(Boolean).join('\n');
      if (r.action === 'new') {
        await tx.job.create({ data: {
          clientId: p.clientId, vmsProgramId: p.id, vmsReqId: r.reqId, title: r.title, location: r.location, openings: r.openings ?? 1, type: 'CONTRACT',
          billRate: r.billRate ?? undefined, payRate: r.payRate ?? undefined, startDate: r.startDate ? day(r.startDate) : undefined, status: r.status ?? 'OPEN', publish: false,
          description: [r.description, notes].filter(Boolean).join('\n\n') || null,
        } as never });
      } else if (r.action === 'update' && r.jobId) {
        await tx.job.updateMany({ where: { id: r.jobId }, data: {
          title: r.title, ...(r.openings !== null && { openings: r.openings }), ...(r.billRate !== null && { billRate: r.billRate }), ...(r.payRate !== null && { payRate: r.payRate }),
          ...(r.location && { location: r.location }), ...(r.startDate && { startDate: day(r.startDate) }), ...(r.status && { status: r.status }),
        } });
      }
    }
    const data: Record<string, unknown> = { lastImportAt: new Date() };
    if (mapping) data.mappings = { ...((p.mappings as Mappings | null) ?? {}), requisitions: mapping };
    await tx.vmsProgram.updateMany({ where: { id: p.id }, data });
  });
  const c = plan.counts, text2 = `Imported requisitions from ${VMS[p.vms as VmsKind]?.label ?? 'the VMS'} (${p.name}): ${c.new} new, ${c.update} updated${c.skip ? `, ${c.skip} skipped` : ''}`;
  await logActivity(org.id, text2, user.id);
  await audit(org.id, user, 'vms.import', text2, { targetType: 'vmsProgram', targetId: p.id });
  return plan.counts;
}

// ---- time ----
/** Approved hours for the program's jobs in one week, and which were already sent. */
export async function programTime(tdb: TenantDb, p: VmsProgram, weekEnding: string) {
  const sheets = await tdb.timesheet.findMany({
    where: { weekEnding: day(weekEnding), status: { in: ['APPROVED', 'PAID'] }, application: { job: { vmsProgramId: p.id } } },
    include: { application: { select: { vmsWorkOrderId: true, vmsWorkerId: true, candidate: { select: { name: true } }, job: { select: { vmsReqId: true } } } } },
  });
  const pending = await tdb.timesheet.count({ where: { weekEnding: day(weekEnding), status: 'DRAFT', application: { job: { vmsProgramId: p.id } } } });
  const rows: (TimeRow & { exportedAt: string | null })[] = sheets.map((t) => ({
    timesheetId: t.id, reqId: t.application.job.vmsReqId, workOrderId: t.application.vmsWorkOrderId, workerId: t.application.vmsWorkerId, worker: t.application.candidate.name,
    weekEnding, regularHours: Number(t.regularHours), overtimeHours: Number(t.overtimeHours), billRate: Number(t.billRate), exportedAt: t.vmsExportedAt?.toISOString() ?? null,
  }));
  return { rows, pending };
}

export async function exportTime(tdb: TenantDb, org: Organization, user: User, p: VmsProgram, weekEnding: string, onlyNew: boolean) {
  const { rows } = await programTime(tdb, p, weekEnding);
  const use = onlyNew ? rows.filter((r) => !r.exportedAt) : rows;
  const kind = (isVms(p.vms) ? p.vms : 'other') as VmsKind;
  const file = timeFile(use, kind, { supplierCode: p.supplierCode, headers: (p.mappings as Mappings | null)?.time, rateCodes: p.rateCodes as { regular?: string; overtime?: string } | null });
  const sent = use.filter((r) => r.workOrderId).map((r) => r.timesheetId);
  if (sent.length) await tdb.timesheet.updateMany({ where: { id: { in: sent } }, data: { vmsExportedAt: new Date() } });
  await audit(org.id, user, 'vms.export', `Exported ${sent.length} timesheet${sent.length === 1 ? '' : 's'} for ${p.name} (week ending ${weekEnding})`, { targetType: 'vmsProgram', targetId: p.id });
  return file;
}

// ---- remittance ----
type RemitAction = 'pay' | 'paid' | 'duplicate' | 'not_found' | 'over' | 'skip';

export async function planRemittance(tdb: TenantDb, p: VmsProgram, text: string, mapping?: Mappings['remittance']) {
  const kind = (isVms(p.vms) ? p.vms : 'other') as VmsKind;
  const read = readRemittance(text, kind, mapping ?? ((p.mappings as Mappings | null)?.remittance ?? {}));
  const numbers = [...new Set(read.rows.map((r) => r.invoice).filter(Boolean))];
  const invoices = numbers.length ? await tdb.invoice.findMany({ where: { clientId: p.clientId, number: { in: numbers, mode: 'insensitive' } }, include: { payments: true } }) : [];
  const owed = new Map(invoices.map((i) => [i.id, toCents(i.total) - toCents(i.amountPaid)]));
  const rows = read.rows.map((r) => {
    const inv = invoices.find((i) => i.number.toLowerCase() === r.invoice.toLowerCase());
    let action: RemitAction = 'pay', fee = 0;
    const paid = r.amount !== null ? Math.round(r.amount * 100) : 0;
    if (r.problems.length) action = 'skip';
    else if (!inv) action = 'not_found';
    else if (inv.status === 'VOID') { action = 'skip'; r.problems.push('That invoice is void.'); }
    else if (r.reference && inv.payments.some((x) => x.reference === r.reference && toCents(x.amount) === paid)) action = 'duplicate';
    else {
      const bal = owed.get(inv.id)!;
      if (bal <= 0) action = 'paid';
      else if (paid > bal) action = 'over';
      else {
        fee = feeFor(bal, paid, r.fee !== null ? Math.round(r.fee * 100) : null, Number(p.feePct));
        owed.set(inv.id, bal - paid - fee); // two rows for one invoice count against what's left
      }
    }
    return { ...r, action, invoiceId: inv?.id ?? null, balance: inv ? toCents(inv.total) - toCents(inv.amountPaid) : null, paidCents: paid, feeCents: fee };
  });
  const sum = (a: RemitAction) => rows.filter((r) => r.action === a);
  return {
    headers: read.headers, columns: read.columns, missing: read.missing, truncated: read.truncated, rows,
    counts: { pay: sum('pay').length, paid: sum('paid').length, duplicate: sum('duplicate').length, not_found: sum('not_found').length, over: sum('over').length, skip: sum('skip').length },
    totalCents: sum('pay').reduce((s, r) => s + r.paidCents, 0), feeCents: sum('pay').reduce((s, r) => s + r.feeCents, 0),
  };
}

/** Records each matched remittance line as a payment, and the VMS fee taken out of it as a separate line, so the invoice closes. */
export async function importRemittance(tdb: TenantDb, org: Organization, user: User, p: VmsProgram, text: string, mapping?: Mappings['remittance']) {
  const plan = await planRemittance(tdb, p, text, mapping);
  if (plan.missing.length) throw new HttpError(400, `Choose the column for: ${plan.missing.join(', ')}.`);
  const today = ymd(new Date()), label = VMS[p.vms as VmsKind]?.label ?? 'VMS';
  let recorded = 0;
  for (const r of plan.rows.filter((x) => x.action === 'pay')) {
    const receivedOn = r.paidOn && r.paidOn <= today ? r.paidOn : today;
    await recordPayment(tdb, org, user, await loadInvoice(tdb, r.invoiceId!), { amount: r.paidCents / 100, receivedOn, method: 'ach', reference: r.reference ?? undefined, notes: `${label} remittance (${p.name})` });
    if (r.feeCents) await recordPayment(tdb, org, user, await loadInvoice(tdb, r.invoiceId!), { amount: r.feeCents / 100, receivedOn, method: 'vms_fee', reference: r.reference ?? undefined, notes: `${label} fee withheld (${p.name})` });
    recorded++;
  }
  if (mapping) await tdb.vmsProgram.updateMany({ where: { id: p.id }, data: { mappings: { ...((p.mappings as Mappings | null) ?? {}), remittance: mapping } } });
  return { recorded, counts: plan.counts, totalCents: plan.totalCents, feeCents: plan.feeCents };
}

// ---- placements ----
/** Workers placed on the program's jobs, with their VMS work order and worker IDs (time files match on them). */
export async function programPlacements(tdb: TenantDb, p: VmsProgram) {
  const apps = await tdb.application.findMany({
    where: { stage: 'PLACED', job: { vmsProgramId: p.id } },
    include: { candidate: { select: { name: true } }, job: { select: { title: true, vmsReqId: true } } }, orderBy: { createdAt: 'desc' }, take: 500,
  });
  return apps.map((a) => ({ id: a.id, worker: a.candidate.name, job: a.job.title, reqId: a.job.vmsReqId, workOrderId: a.vmsWorkOrderId, workerId: a.vmsWorkerId }));
}

export const PlacementIdsBody = z.object({
  applicationId: z.string().min(1),
  workOrderId: z.string().trim().max(60).regex(/^[\w./-]*$/, 'IDs use letters, numbers, dots, dashes and slashes.').optional().nullable(),
  workerId: z.string().trim().max(60).regex(/^[\w./-]*$/, 'IDs use letters, numbers, dots, dashes and slashes.').optional().nullable(),
});
export async function setPlacementIds(tdb: TenantDb, p: VmsProgram, b: z.infer<typeof PlacementIdsBody>) {
  const app = await tdb.application.findFirst({ where: { id: b.applicationId, job: { vmsProgramId: p.id } }, select: { id: true } });
  if (!app) throw new HttpError(404, 'That placement isn’t in this program.');
  if (b.workOrderId && await tdb.application.findFirst({ where: { vmsWorkOrderId: b.workOrderId, id: { not: app.id }, job: { vmsProgramId: p.id } }, select: { id: true } })) {
    throw new HttpError(409, `Another placement in this program already has ${b.workOrderId}.`);
  }
  await tdb.application.updateMany({ where: { id: app.id }, data: { ...(b.workOrderId !== undefined && { vmsWorkOrderId: b.workOrderId || null }), ...(b.workerId !== undefined && { vmsWorkerId: b.workerId || null }) } });
}
