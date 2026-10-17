import { z } from 'zod';
import { Prisma, type Organization, type User } from '@prisma/client';
import { HttpError, logActivity, type TenantDb } from './tenant';
import { audit } from './audit';
import { cents, dollars } from './payroll-run';
import { DEDUCTION_TYPES, activeOn, deductionCents, describe, type DeductionType } from './deductions';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
type Tx = Omit<TenantDb, '$transaction' | '$connect' | '$disconnect' | '$on' | '$use' | '$extends'>;

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date.');
export const DeductionBody = z.object({
  candidateId: z.string().min(1, 'Choose the worker.'),
  type: z.enum(Object.keys(DEDUCTION_TYPES) as [DeductionType], { errorMap: () => ({ message: 'Choose the kind of deduction.' }) }),
  label: z.string().trim().max(60).optional().nullable(),
  code: z.string().trim().max(12).regex(/^[\w-]*$/, 'Codes use letters, numbers and dashes.').optional().nullable(),
  amountType: z.enum(['FIXED', 'PERCENT']),
  amount: z.number({ invalid_type_error: 'Enter the amount.' }).positive('Enter an amount above zero.').max(100000),
  annualLimit: z.number().positive('The annual limit must be above zero.').max(1000000).optional().nullable(),
  employerAmount: z.number().min(0).max(100000).optional().nullable(),
  startDate: Day,
  endDate: Day.optional().nullable(),
}).refine((b) => b.amountType !== 'PERCENT' || b.amount <= 100, { message: 'A percent can’t be more than 100.', path: ['amount'] })
  .refine((b) => !b.endDate || b.endDate >= b.startDate, { message: 'It can’t end before it starts.', path: ['endDate'] });

export function deductionView(d: Prisma.PayDeductionGetPayload<{ include: { candidate: { select: { name: true } } } }>) {
  return {
    id: d.id, candidateId: d.candidateId, worker: d.candidate.name, type: d.type, label: d.label, code: d.code, pretax: d.pretax, amountType: d.amountType as 'FIXED' | 'PERCENT',
    amount: Number(d.amount), annualLimit: d.annualLimit === null ? null : Number(d.annualLimit), employerAmount: d.employerAmount === null ? null : Number(d.employerAmount),
    startDate: ymd(d.startDate), endDate: d.endDate ? ymd(d.endDate) : null, syncedToProvider: !!d.providerId,
  };
}

export async function listDeductions(tdb: TenantDb, today = ymd(new Date())) {
  const rows = await tdb.payDeduction.findMany({ include: { candidate: { select: { name: true } } }, orderBy: [{ candidate: { name: 'asc' } }, { startDate: 'asc' }] });
  return rows.map(deductionView).map((d) => ({ ...d, active: !d.endDate || d.endDate >= today }));
}

export async function createDeduction(tdb: TenantDb, org: Organization, user: User, b: z.infer<typeof DeductionBody>) {
  const c = await tdb.candidate.findFirst({ where: { id: b.candidateId }, select: { name: true } });
  if (!c) throw new HttpError(404, 'That worker was deleted.');
  const t = DEDUCTION_TYPES[b.type];
  if (await tdb.payDeduction.findFirst({ where: { candidateId: b.candidateId, type: b.type, OR: [{ endDate: null }, { endDate: { gte: day(b.startDate) } }], ...(b.type === 'OTHER' ? { label: b.label || t.label } : {}) } })) {
    throw new HttpError(409, `${c.name} already has ${b.type === 'OTHER' ? 'that deduction' : `a ${/^Roth/.test(t.label) ? t.label : t.label[0].toLowerCase() + t.label.slice(1)} deduction`}. End it first, then add the new amount.`);
  }
  const d = await tdb.payDeduction.create({ data: {
    candidateId: b.candidateId, type: b.type, label: b.label || t.label, code: b.code || t.code, pretax: t.pretax, amountType: b.amountType, amount: new Prisma.Decimal(b.amount),
    annualLimit: b.annualLimit ?? null, employerAmount: b.employerAmount ?? null, startDate: day(b.startDate), endDate: b.endDate ? day(b.endDate) : null, createdById: user.id,
  } as never });
  const text = `Added a deduction for ${c.name}: ${describe({ ...b, label: b.label || t.label, annualLimit: b.annualLimit ?? null, endDate: b.endDate ?? null })}, from ${b.startDate}`;
  await logActivity(org.id, text, user.id);
  await audit(org.id, user, 'payroll.deduction', text, { targetType: 'payDeduction', targetId: d.id });
  return d.id;
}

/** Ends a deduction (it stays on past runs). One never used can be removed outright. */
export async function endDeduction(tdb: TenantDb, org: Organization, user: User, id: string, endDate: string) {
  const d = await tdb.payDeduction.findFirst({ where: { id }, include: { candidate: { select: { name: true } } } });
  if (!d) throw new HttpError(404, 'That deduction was deleted.');
  if (endDate < ymd(d.startDate)) {
    if (await tdb.payrollAdjustment.count({ where: { deductionId: id } })) throw new HttpError(400, 'It was already taken in a payroll run, so it can only end on or after its start date.');
    await tdb.payDeduction.deleteMany({ where: { id } });
  } else await tdb.payDeduction.updateMany({ where: { id }, data: { endDate: day(endDate) } });
  // Draft runs paid after the end date drop it.
  for (const run of await tdb.payrollRun.findMany({ where: { status: 'DRAFT', items: { some: { candidateId: d.candidateId } } } })) await tdb.$transaction((tx) => applyDeductions(tx, run));
  const text = `Ended ${d.candidate.name}’s ${d.label} deduction${endDate < ymd(d.startDate) ? ' (removed; never taken)' : ` after ${endDate}`}`;
  await logActivity(org.id, text, user.id);
  await audit(org.id, user, 'payroll.deduction', text, { targetType: 'payDeduction', targetId: id });
}

/**
 * Recalculates a draft run's recurring deductions: removes the ones it had and adds each worker's active deductions
 * (pre-tax first, then after-tax), on their first line in the run. Hand-entered adjustments are left alone.
 */
export async function applyDeductions(tx: Tx, run: { id: string; payDate: Date; status?: string }) {
  if (run.status && run.status !== 'DRAFT') return;
  await tx.payrollAdjustment.deleteMany({ where: { item: { runId: run.id }, deductionId: { not: null } } });
  const items = await tx.payrollItem.findMany({ where: { runId: run.id }, include: { adjustments: true }, orderBy: [{ weekEnding: 'asc' }, { createdAt: 'asc' }] });
  if (!items.length) return;
  const people = [...new Set(items.map((i) => i.candidateId))];
  const payDate = ymd(run.payDate), year = payDate.slice(0, 4);
  const deductions = (await tx.payDeduction.findMany({ where: { candidateId: { in: people } }, orderBy: [{ pretax: 'desc' }, { createdAt: 'asc' }] }))
    .filter((d) => activeOn({ startDate: ymd(d.startDate), endDate: d.endDate ? ymd(d.endDate) : null }, payDate));
  if (!deductions.length) return;
  // Taken so far this calendar year, in other runs that weren't voided.
  const taken = await tx.payrollAdjustment.groupBy({
    by: ['deductionId'], _sum: { amount: true },
    where: { deductionId: { in: deductions.map((d) => d.id) }, item: { run: { id: { not: run.id }, status: { not: 'VOID' }, payDate: { gte: day(`${year}-01-01`), lte: day(`${year}-12-31`) } } } },
  });
  const takenBy = new Map(taken.map((t) => [t.deductionId!, cents(Number(t._sum.amount ?? 0))]));
  for (const person of people) {
    const mine = items.filter((i) => i.candidateId === person);
    let gross = 0, manualDed = 0;
    for (const i of mine) {
      gross += cents(Number(i.regularPay)) + cents(Number(i.overtimePay)) + cents(Number(i.leavePay));
      for (const a of i.adjustments) { const c = cents(Number(a.amount)); if (a.kind === 'BONUS' || a.kind === 'OTHER_EARNING') gross += c; else if (a.kind === 'DEDUCTION' && !a.deductionId) manualDed += c; }
    }
    let available = gross - manualDed;
    for (const d of deductions.filter((x) => x.candidateId === person)) {
      const r = deductionCents({ amountType: d.amountType as 'FIXED' | 'PERCENT', amount: Number(d.amount), annualLimit: d.annualLimit === null ? null : Number(d.annualLimit), startDate: '', endDate: null }, gross, takenBy.get(d.id) ?? 0, available);
      if (!r.cents) continue;
      available -= r.cents;
      await tx.payrollAdjustment.create({ data: {
        itemId: mine[0].id, kind: d.pretax ? 'PRETAX_DEDUCTION' : 'DEDUCTION', description: r.note ? `${d.label} (${r.note})` : d.label,
        amount: new Prisma.Decimal(dollars(r.cents)), deductionId: d.id, code: d.code,
      } as never });
    }
  }
}
