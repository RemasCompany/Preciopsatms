import type { TenantDb } from './tenant';
import { hoursAmount, leaveAmount } from './payroll';
import { hourlyWhere } from './schedule-server';
import { sheetPremiums } from './differentials-server';
import type { PremiumLine } from './differentials';

export type TimesheetRow = {
  applicationId: string; worker: string; email: string | null; job: string; client: { id: string; name: string } | null;
  status: 'NOT_ENTERED' | 'DRAFT' | 'APPROVED' | 'PAID'; reg: number; ot: number; leave: number; pay: number; bill: number; gross: number; billable: number;
  premiums: (PremiumLine & { label: string })[]; premiumPay: number; premiumBill: number; // differentials, with the overtime they add
  clientApprovedBy?: string | null; clientDispute?: string | null; // from the client portal
};

/** Everyone on assignment (placed on a non-direct-hire job) with their timesheet for the week. */
export async function timesheetRows(tdb: TenantDb, week: Date, branchId?: string | null): Promise<TimesheetRow[]> {
  const apps = await tdb.application.findMany({
    where: { ...hourlyWhere, job: { ...hourlyWhere.job, ...(branchId ? { branchId } : {}) } },
    include: { employee: { select: { payRate: true } }, candidate: { select: { name: true, email: true } }, job: { select: { title: true, payRate: true, billRate: true, client: { select: { id: true, name: true } } } }, timesheets: { where: { weekEnding: week }, include: { premiums: true } } },
    orderBy: { candidate: { name: 'asc' } },
  });
  return apps.map((a) => {
    const t = a.timesheets[0];
    // Entered timesheets use the rates snapshotted at entry; blank weeks preview the current rate (an employee's own, else the job's).
    const pay = Number(t?.payRate ?? a.employee?.payRate ?? a.job.payRate ?? 0), bill = Number(t?.billRate ?? a.job.billRate ?? 0);
    const reg = Number(t?.regularHours ?? 0), ot = Number(t?.overtimeHours ?? 0), leave = Number(t?.leaveHours ?? 0);
    const prem = sheetPremiums({ regularHours: reg, overtimeHours: ot, premiums: t?.premiums });
    return { applicationId: a.id, worker: a.candidate.name, email: a.candidate.email, job: a.job.title, client: a.job.client, status: t?.status ?? 'NOT_ENTERED', reg, ot, leave, pay, bill,
      // Paid time off is paid at the regular rate and never billed to a client.
      gross: hoursAmount(reg, ot, pay) + leaveAmount(leave, pay) + prem.pay, billable: hoursAmount(reg, ot, bill) + prem.bill,
      premiums: prem.lines, premiumPay: prem.pay, premiumBill: prem.bill,
      clientApprovedBy: t?.clientApprovedAt ? t.clientApprovedBy ?? 'client' : null, clientDispute: t?.clientDisputeNote ?? null };
  });
}
