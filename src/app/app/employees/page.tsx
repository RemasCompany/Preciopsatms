import Link from 'next/link';
import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature, planIncludes } from '@/lib/plans';
import { employeeList, isAdmin } from '@/lib/people';
import Employees from '@/components/Employees';
import Gate from '@/components/Gate';

export const dynamic = 'force-dynamic';
const STATUS = { current: 'Current', ON_LEAVE: 'On leave', TERMINATED: 'Former', all: 'Everyone' } as const;

export default async function EmployeesPage({ searchParams }: { searchParams: { status?: string; department?: string; branch?: string; q?: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'people')) {
    if (ctx.org.kind !== 'EMPLOYER' && planIncludes(ctx.org, 'people')) return <Gate title="Our employees" feature="Employee records for your own staff" off />;
    return <Gate title="Employees" feature="Employee records" />;
  }
  const status = searchParams.status && searchParams.status in STATUS ? searchParams.status : 'current';
  const [rows, everyone, departments, branches] = await Promise.all([
    employeeList(ctx.tdb, ctx.role, { status, department: searchParams.department, branch: searchParams.branch, q: searchParams.q?.trim().slice(0, 80) }),
    employeeList(ctx.tdb, ctx.role, { status: 'all' }),
    ctx.tdb.department.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    ctx.tdb.branch.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const current = everyone.filter((e) => e.status !== 'TERMINATED');
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const left = everyone.filter((e) => e.endDate && e.endDate >= yearAgo && e.status === 'TERMINATED').length;
  const turnover = current.length + left ? Math.round((left / ((current.length + left) || 1)) * 100) : 0;
  const q = (o: Record<string, string>) => `?${new URLSearchParams({ ...(status !== 'current' ? { status } : {}), ...o }).toString()}`;
  const employer = ctx.org.kind === 'EMPLOYER';

  return (
    <>
      <h1>{employer ? 'Employees' : 'Our employees'}</h1>
      <p className="lede">{employer
        ? 'Everyone on your payroll: their job, department, location, manager and pay history. Employees are scheduled, clock in and get timesheets like anyone else; hiring someone through the pipeline adds them here.'
        : 'Your agency’s own staff — recruiters, account managers and office team — kept separate from the workers you place.'}</p>
      <div className="kpis">
        <Link className="kpi" href="?"><b>{current.length}</b><span>Current employees</span></Link>
        <Link className="kpi" href="?status=ON_LEAVE"><b>{current.filter((e) => e.status === 'ON_LEAVE').length}</b><span>On leave</span></Link>
        <div className="kpi"><b>{current.filter((e) => e.startDate >= since).length}</b><span>Hired in 90 days</span></div>
        <div className="kpi"><b>{turnover}%</b><span>Turnover, last 12 months</span></div>
      </div>
      <form className="bar" style={{ gap: 8 }}>
        <input name="q" defaultValue={searchParams.q ?? ''} placeholder="Search name, title or employee #" aria-label="Search employees" style={{ flex: '1 1 220px' }} />
        <select name="status" defaultValue={status} aria-label="Status">{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {departments.length > 0 && <select name="department" defaultValue={searchParams.department ?? ''} aria-label="Department"><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
        {branches.length > 0 && <select name="branch" defaultValue={searchParams.branch ?? ''} aria-label="Location"><option value="">All locations</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
        <button className="btn ghost">Show</button>
        {employer && <Link className="btn ghost" href="/app/employees/org-chart">Org chart</Link>}
        {(searchParams.q || searchParams.department || searchParams.branch) && <Link className="btn ghost sm" href={q({})}>Clear</Link>}
      </form>
      <Employees rows={rows} everyone={current.map((e) => ({ id: e.id, name: e.name, title: e.title }))} departments={departments} branches={branches}
        canEdit={canEdit(ctx)} admin={isAdmin(ctx.role) && canEdit(ctx)} />
    </>
  );
}
