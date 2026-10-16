import { requireApiContext, withApi } from '@/lib/tenant';
import { currentBranch } from '@/lib/branches';
import { hoursOnly, loadPlanning, planningCsv, type Group } from '@/lib/planning-server';

export const dynamic = 'force-dynamic';

/** Labor planning as CSV: months this year vs last, the 13-week forecast, and the hiring plan. Cost for owners and admins only. */
export const GET = withApi(async (req: Request) => {
  const ctx = await requireApiContext({ minRole: 'RECRUITER', feature: 'timesheets' });
  const u = new URL(req.url), money = ctx.role === 'OWNER' || ctx.role === 'ADMIN';
  const { branch } = await currentBranch(ctx);
  const p = await loadPlanning(ctx.tdb, ctx.org, { year: Number(u.searchParams.get('year')) || undefined, group: (u.searchParams.get('group') ?? undefined) as Group, branchId: branch?.id ?? null });
  return new Response(planningCsv(money ? p : hoursOnly(p), money), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="labor-planning-${p.year}-${p.group}.csv"`, 'Cache-Control': 'private, no-store' } });
});
