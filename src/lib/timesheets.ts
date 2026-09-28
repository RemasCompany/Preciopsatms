import type { TenantDb } from './tenant';
import { hoursAmount } from './payroll';

export type TimesheetRow = {
  applicationId: string; worker: string; email: string | null; job: string; client: { id: string; name: string } | null;
  status: 'NOT_ENTERED' | 'DRAFT' | 'APPROVED' | 'PAID'; reg: number; ot: number; pay: number; bill: number; gross: number; billable: number;
};

/** Everyone on assignment (placed on a non-direct-hire job) with their timesheet for the week. */
export async function timesheetRows(tdb: TenantDb, week: Date): Promise<TimesheetRow[]> {
  const apps = await tdb.application.findMany({
    where: { stage: 'PLACED', job: { type: { not: 'DIRECT_HIRE' } } },
    include: { candidate: { select: { name: true, email: true } }, job: { select: { title: true, payRate: true, billRate: true, client: { select: { id: true, name: true } } } }, timesheets: { where: { weekEnding: week } } },
    orderBy: { candidate: { name: 'asc' } },
  });
  return apps.map((a) => {
    const t = a.timesheets[0];
    // Entered timesheets use the rates snapshotted at entry; blank weeks preview the job's current rates.
    const pay = Number(t?.payRate ?? a.job.payRate ?? 0), bill = Number(t?.billRate ?? a.job.billRate ?? 0);
    const reg = Number(t?.regularHours ?? 0), ot = Number(t?.overtimeHours ?? 0);
    return { applicationId: a.id, worker: a.candidate.name, email: a.candidate.email, job: a.job.title, client: a.job.client, status: t?.status ?? 'NOT_ENTERED', reg, ot, pay, bill,
      gross: hoursAmount(reg, ot, pay), billable: hoursAmount(reg, ot, bill) };
  });
}
