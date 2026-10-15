import Link from 'next/link';
import { requirePageContext } from '@/lib/tenant';
import { hasFeature, planIncludes } from '@/lib/plans';
import { employeeList, type EmployeeRow } from '@/lib/people';
import Gate from '@/components/Gate';

export const dynamic = 'force-dynamic';

/** Who reports to whom. People without a manager are at the top; each level is sorted by name. */
export default async function OrgChart({ searchParams }: { searchParams: { department?: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'people')) return <Gate title="Org chart" feature="Employee records" off={ctx.org.kind !== 'EMPLOYER' && planIncludes(ctx.org, 'people')} />;
  const [all, departments] = await Promise.all([employeeList(ctx.tdb, ctx.role), ctx.tdb.department.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })]);
  const dept = departments.some((d) => d.id === searchParams.department) ? searchParams.department! : '';
  const kids = new Map<string | null, EmployeeRow[]>();
  for (const e of all) { const k = all.some((m) => m.id === e.managerId) ? e.managerId : null; kids.set(k, [...(kids.get(k) ?? []), e]); }
  // With a department chosen, show its people under their managers (the managers may be in other departments).
  const inDept = (e: EmployeeRow): boolean => !dept || e.departmentId === dept || (kids.get(e.id) ?? []).some(inDept);
  const Node = ({ e }: { e: EmployeeRow }) => {
    const under = (kids.get(e.id) ?? []).filter(inDept);
    return (
      <li>
        <div className={`orgcard${dept && e.departmentId !== dept ? ' dim' : ''}`}>
          <b>{e.name}</b><span>{e.title}</span>
          {(e.department || e.location) && <span className="muted">{[e.department, e.location].filter(Boolean).join(' · ')}</span>}
          {e.status === 'ON_LEAVE' && <span className="pill a">On leave</span>}
        </div>
        {under.length > 0 && <ul>{under.map((c) => <Node key={c.id} e={c} />)}</ul>}
      </li>
    );
  };
  const roots = (kids.get(null) ?? []).filter(inDept);
  return (
    <>
      <h1>Org chart</h1>
      <p className="lede">Who reports to whom. Set each person’s manager on the <Link href="/app/employees">Employees</Link> page; when someone leaves, their reports move up to their manager.</p>
      {departments.length > 0 && (
        <form className="bar"><select name="department" defaultValue={dept} aria-label="Department"><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select><button className="btn ghost">Show</button></form>
      )}
      {roots.length ? <div className="orgchart"><ul>{roots.map((e) => <Node key={e.id} e={e} />)}</ul></div>
        : <div className="card empty"><b>No one to show</b>Add employees and set their managers to build the chart.</div>}
    </>
  );
}
