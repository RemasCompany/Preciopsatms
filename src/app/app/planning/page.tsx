import { requirePageContext } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { currentBranch } from '@/lib/branches';
import { GROUPS, groupsFor, hoursOnly, loadPlanning, type Group } from '@/lib/planning-server';
import PlanningView from '@/components/Planning';
import Gate from '@/components/Gate';

export const dynamic = 'force-dynamic';

export default async function PlanningPage({ searchParams }: { searchParams: { year?: string; group?: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'timesheets')) return <Gate title="Labor planning" feature="Labor planning and hiring forecasts" employer={ctx.org.kind === 'EMPLOYER'} />;
  if (ctx.role === 'VIEWER') return <><h1>Labor planning</h1><div className="card empty"><b>Ask an admin for access</b>Labor planning is for owners, admins and recruiters.</div></>;
  const money = ctx.role === 'OWNER' || ctx.role === 'ADMIN';
  const { branch } = await currentBranch(ctx);
  const p = await loadPlanning(ctx.tdb, ctx.org, { year: Number(searchParams.year) || undefined, group: searchParams.group as Group, branchId: branch?.id ?? null });
  return (
    <>
      <h1>Labor planning</h1>
      <p className="lede">This year against last year{money ? ' — hours, labor cost and people' : ' — hours and people'} — a 13-week forecast of the hours you’ll need, and when to start hiring to cover them.{branch ? ` Showing ${branch.name}.` : ''}</p>
      <PlanningView p={money ? p : hoursOnly(p)} money={money} groups={groupsFor(ctx.org.kind).map((g) => ({ key: g, label: GROUPS[g] }))} years={[p.thisYear, p.thisYear - 1, p.thisYear - 2]} />
    </>
  );
}
