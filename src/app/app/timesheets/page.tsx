import Link from 'next/link';
import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { parseWeek, ymd, addWeeks } from '@/lib/weeks';
import { timesheetRows } from '@/lib/timesheets';
import TimesheetGrid from '@/components/TimesheetGrid';
import Gate from '@/components/Gate';

export default async function Timesheets({ searchParams }: { searchParams: { week?: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'timesheets')) return <Gate title="Timesheets & payroll" feature="Timesheets and payroll" />;
  let week: Date;
  try { week = parseWeek(searchParams.week ?? null); } catch { week = parseWeek(null); }
  const rows = await timesheetRows(ctx.tdb, week);
  const admin = ctx.role === 'OWNER' || ctx.role === 'ADMIN';
  return (
    <>
      <h1>Timesheets & payroll</h1>
      <p className="lede">Enter weekly hours for everyone on assignment, approve them, then send payroll and invoice your clients from the same numbers. Overtime pays and bills at 1.5x.</p>
      <TimesheetGrid key={ymd(week)} week={ymd(week)} prev={ymd(addWeeks(week, -1))} next={ymd(addWeeks(week, 1))} rows={rows} canEdit={canEdit(ctx)} admin={admin && canEdit(ctx)} />
      {hasFeature(ctx.org, 'payrollRuns') && admin && <p className="card banner" style={{ marginTop: 14 }}>Approved hours go into <Link href="/app/payroll">payroll runs</Link>: add bonuses and reimbursements, approve, export for your provider and invoice clients per pay period.</p>}
      <p className="muted" style={{ marginTop: 14 }}>The payroll export has one row per worker with regular and overtime hours and rates, in a layout Gusto, ADP and QuickBooks Payroll can import after you match the columns once.</p>
    </>
  );
}
