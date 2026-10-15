import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature, planIncludes } from '@/lib/plans';
import { balances, tracked } from '@/lib/leave';
import { isAdmin } from '@/lib/people';
import TimeOff, { type LeaveRow, type PolicyRow, type BalanceRow } from '@/components/TimeOff';
import Gate from '@/components/Gate';

export const dynamic = 'force-dynamic';
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export default async function TimeOffPage({ searchParams }: { searchParams: { month?: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'timeoff')) return <Gate title="Time off" feature="Time off and balances" off={planIncludes(ctx.org, 'timeoff') && ctx.org.kind !== 'EMPLOYER'} />;
  const { tdb } = ctx;
  const now = new Date();
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? '') ? searchParams.month! : ymd(now).slice(0, 7);
  const first = new Date(`${month}-01T00:00:00Z`), last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const [policies, employees, requests, inMonth] = await Promise.all([
    tdb.leavePolicy.findMany({ orderBy: [{ archived: 'asc' }, { name: 'asc' }] }),
    tdb.employee.findMany({ where: { status: { not: 'TERMINATED' } }, include: { candidate: { select: { name: true } }, department: { select: { name: true } } }, orderBy: { candidate: { name: 'asc' } } }),
    tdb.leaveRequest.findMany({ where: { OR: [{ status: 'PENDING' }, { status: 'APPROVED', endDate: { gte: new Date(now.getTime() - 30 * 864e5) } }, { status: { in: ['DENIED', 'CANCELLED'] }, updatedAt: { gte: new Date(now.getTime() - 30 * 864e5) } }] },
      include: { employee: { include: { candidate: { select: { name: true } } } }, policy: { select: { name: true, paid: true } } }, orderBy: [{ startDate: 'asc' }], take: 300 }),
    tdb.leaveRequest.findMany({ where: { status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: last }, endDate: { gte: first } }, include: { employee: { include: { candidate: { select: { name: true } } } }, policy: { select: { name: true } } } }),
  ]);
  const bal = await balances(tdb, employees.map((e) => e.id));
  const live = policies.filter((p) => !p.archived);
  const row = (r: (typeof requests)[number]): LeaveRow => ({
    id: r.id, employeeId: r.employeeId, employee: r.employee.candidate.name, policy: r.policy.name, paid: r.policy.paid, start: ymd(r.startDate), end: ymd(r.endDate),
    hours: Number(r.hours), note: r.note, status: r.status, decisionNote: r.decisionNote, byEmployee: r.byEmployee,
  });
  const policyRows: PolicyRow[] = policies.map((p) => ({ id: p.id, name: p.name, paid: p.paid, method: p.method, rate: Number(p.rate), maxBalance: p.maxBalance == null ? null : Number(p.maxBalance), waitingDays: p.waitingDays, types: p.types, archived: p.archived }));
  const balanceRows: BalanceRow[] = employees.map((e) => ({
    employeeId: e.id, name: e.candidate.name, department: e.department?.name ?? null, type: e.employmentType,
    cells: live.filter((p) => tracked(p) && (!p.types.length || p.types.includes(e.employmentType))).map((p) => ({ policyId: p.id, ...bal.get(e.id, p.id) })),
  }));
  const today = ymd(now);
  const out = requests.filter((r) => r.status === 'APPROVED' && ymd(r.startDate) <= today && ymd(r.endDate) >= today).length;
  const employer = ctx.org.kind === 'EMPLOYER';

  return (
    <>
      <h1>{employer ? 'Time off' : 'Staff time off'}</h1>
      <p className="lede">Vacation, sick and other leave: balances that accrue on their own, requests to approve, and who’s out when. Approved paid time off goes onto the employee’s timesheet at their regular rate, and their shifts on those days come off the schedule.</p>
      <div className="kpis">
        <div className="kpi"><b className={requests.some((r) => r.status === 'PENDING') ? 'warnnum' : undefined}>{requests.filter((r) => r.status === 'PENDING').length}</b><span>Waiting for approval</span></div>
        <div className="kpi"><b>{out}</b><span>Out today</span></div>
        <div className="kpi"><b>{requests.filter((r) => r.status === 'APPROVED' && ymd(r.startDate) > today && ymd(r.startDate) <= ymd(new Date(now.getTime() + 14 * 864e5))).length}</b><span>Starting in 2 weeks</span></div>
        <div className="kpi"><b>{live.length}</b><span>Policies</span></div>
      </div>
      <TimeOff requests={requests.map(row)} month={month} calendar={inMonth.map((r) => ({ id: r.id, employee: r.employee.candidate.name, policy: r.policy.name, start: ymd(r.startDate), end: ymd(r.endDate), status: r.status }))}
        policies={policyRows} balances={balanceRows} employees={employees.map((e) => ({ id: e.id, name: e.candidate.name, type: e.employmentType }))}
        canEdit={canEdit(ctx)} admin={isAdmin(ctx.role) && canEdit(ctx)} today={today} />
    </>
  );
}
