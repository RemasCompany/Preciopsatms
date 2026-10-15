import { requireApiContext, withApi } from '@/lib/tenant';
import { parseWeek, ymd } from '@/lib/weeks';
import { hoursAmount, leaveAmount, overtimeRate } from '@/lib/payroll';

const cell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** Payroll CSV for approved/paid hours. Columns map cleanly into Gusto, ADP and QuickBooks Payroll imports. */
// Per-user data: never pre-render or cache.
export const dynamic = 'force-dynamic';

export const GET = withApi(async (req: Request) => {
  const { tdb } = await requireApiContext({ minRole: 'ADMIN', feature: 'timesheets' });
  const week = parseWeek(new URL(req.url).searchParams.get('week'));
  const ts = await tdb.timesheet.findMany({ where: { weekEnding: week, status: { in: ['APPROVED', 'PAID'] } }, include: { application: { include: { candidate: true, job: { include: { client: true } } } } } });
  // The time-off column only appears when someone had time off, so existing import templates keep matching.
  const pto = ts.some((t) => Number(t.leaveHours) > 0);
  const header = ['Employee name', 'First name', 'Last name', 'Email', 'Phone', 'Week ending', 'Regular hours', 'Overtime hours', ...(pto ? ['Time off hours'] : []), 'Regular rate', 'Overtime rate', 'Gross pay', 'Client', 'Position', 'Job ID'];
  const rows = ts.map((t) => {
    const c = t.application.candidate; const [first, ...last] = c.name.split(' ');
    const pay = Number(t.payRate), reg = Number(t.regularHours), ot = Number(t.overtimeHours), leave = Number(t.leaveHours);
    return [c.name, first, last.join(' '), c.email, c.phone, ymd(week), reg.toFixed(2), ot.toFixed(2), ...(pto ? [leave.toFixed(2)] : []), pay.toFixed(2), overtimeRate(pay).toFixed(2), (hoursAmount(reg, ot, pay) + leaveAmount(leave, pay)).toFixed(2), t.application.job.client?.name, t.application.job.title, t.application.jobId];
  });
  const csv = [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="payroll-${ymd(week)}.csv"` } });
});
