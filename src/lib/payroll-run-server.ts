import { Prisma } from '@prisma/client';
import { HttpError, type TenantDb } from './tenant';
import { wages, dollars, runChecks, type Frequency, type RunItem } from './payroll-run';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
export const periodStartFor = (periodEnd: string, frequency: Frequency) => new Date(day(periodEnd).getTime() - ((frequency === 'BIWEEKLY' ? 14 : 7) - 1) * 864e5);
/** Week-ending Sundays inside a pay period. */
export const weeksIn = (periodEnd: string, frequency: Frequency) => (frequency === 'BIWEEKLY' ? [new Date(day(periodEnd).getTime() - 7 * 864e5), day(periodEnd)] : [day(periodEnd)]);

type Tx = Omit<TenantDb, '$transaction' | '$connect' | '$disconnect' | '$on' | '$use' | '$extends'>;

/**
 * Snapshots every approved timesheet in the run's period that isn't already in another run.
 * Existing items keep their adjustments; items whose timesheet was reopened drop out.
 */
export async function syncItems(tx: Tx, run: { id: string; periodEnd: Date; frequency: string }) {
  const weeks = weeksIn(ymd(run.periodEnd), run.frequency as Frequency);
  const sheets = await tx.timesheet.findMany({
    where: { status: 'APPROVED', weekEnding: { in: weeks }, OR: [{ payrollRunId: null }, { payrollRunId: run.id }] },
    include: { application: { include: { candidate: { select: { id: true, name: true, payrollId: true } }, job: { select: { title: true, client: { select: { id: true, name: true } } } } } } },
  });
  const existing = await tx.payrollItem.findMany({ where: { runId: run.id }, select: { id: true, timesheetId: true } });
  const keep = new Set(sheets.map((s) => s.id));
  const dropped = existing.filter((e) => !keep.has(e.timesheetId));
  if (dropped.length) await tx.payrollItem.deleteMany({ where: { id: { in: dropped.map((d) => d.id) } } });
  // Release timesheets that no longer belong to this run (e.g. reopened).
  await tx.timesheet.updateMany({ where: { payrollRunId: run.id, id: { notIn: [...keep] } }, data: { payrollRunId: null } });
  for (const t of sheets) {
    const reg = Number(t.regularHours), ot = Number(t.overtimeHours), pay = Number(t.payRate);
    const w = wages(reg, ot, pay);
    const data = {
      applicationId: t.applicationId, candidateId: t.application.candidate.id, workerName: t.application.candidate.name, payrollId: t.application.candidate.payrollId,
      position: t.application.job.title, clientId: t.application.job.client?.id ?? null, clientName: t.application.job.client?.name ?? null, weekEnding: t.weekEnding,
      regularHours: t.regularHours, overtimeHours: t.overtimeHours, payRate: t.payRate, billRate: t.billRate,
      regularPay: new Prisma.Decimal(dollars(w.regular)), overtimePay: new Prisma.Decimal(dollars(w.overtime)),
    };
    const had = existing.find((e) => e.timesheetId === t.id);
    if (had) await tx.payrollItem.updateMany({ where: { id: had.id }, data });
    else await tx.payrollItem.create({ data: { ...data, runId: run.id, timesheetId: t.id } as never });
  }
  if (sheets.length) await tx.timesheet.updateMany({ where: { id: { in: sheets.map((s) => s.id) } }, data: { payrollRunId: run.id } });
  return { included: sheets.length, dropped: dropped.length };
}

/** A run with its items in the shape the math and exports use. */
export async function loadRun(tdb: TenantDb, id: string) {
  const run = await tdb.payrollRun.findFirst({ where: { id }, include: { items: { include: { adjustments: { orderBy: { createdAt: 'asc' } } }, orderBy: [{ workerName: 'asc' }, { weekEnding: 'asc' }] } } });
  if (!run) throw new HttpError(404, 'That payroll run was deleted.');
  const items: RunItem[] = run.items.map((i) => ({
    id: i.id, candidateId: i.candidateId, workerName: i.workerName, payrollId: i.payrollId, position: i.position, clientId: i.clientId, clientName: i.clientName,
    weekEnding: ymd(i.weekEnding), regularHours: Number(i.regularHours), overtimeHours: Number(i.overtimeHours), payRate: Number(i.payRate), billRate: Number(i.billRate),
    regularPay: Number(i.regularPay), overtimePay: Number(i.overtimePay),
    adjustments: i.adjustments.map((a) => ({ id: a.id, kind: a.kind, description: a.description, amount: Number(a.amount) })),
  }));
  const meta = { number: run.number, periodStart: ymd(run.periodStart), periodEnd: ymd(run.periodEnd), payDate: ymd(run.payDate) };
  return { run, items, meta };
}

/** Workers on assignment whose hours for the period aren't approved yet (so they're not in the run). */
export async function leftOut(tdb: TenantDb, run: { periodEnd: Date; frequency: string; status: string }) {
  if (run.status !== 'DRAFT') return [];
  const weeks = weeksIn(ymd(run.periodEnd), run.frequency as Frequency);
  const apps = await tdb.application.findMany({
    where: { stage: 'PLACED', job: { type: { not: 'DIRECT_HIRE' } } },
    include: { candidate: { select: { name: true } }, timesheets: { where: { weekEnding: { in: weeks } }, select: { weekEnding: true, status: true } } },
  });
  return apps.flatMap((a) => weeks.flatMap((w) => {
    const t = a.timesheets.find((x) => x.weekEnding.getTime() === w.getTime());
    return !t || t.status === 'DRAFT' ? [{ worker: a.candidate.name, weekEnding: ymd(w), status: t?.status ?? 'NOT_ENTERED' }] : [];
  }));
}

export async function checksFor(tdb: TenantDb, loaded: Awaited<ReturnType<typeof loadRun>>) {
  return runChecks(loaded.items, await leftOut(tdb, loaded.run));
}
