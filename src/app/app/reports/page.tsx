import { requirePageContext } from '@/lib/tenant';
import { db } from '@/lib/db';
import { localDate } from '@/lib/timeclock';
import { REPORTS, type ReportKey } from '@/lib/reports';
import { mayRun } from '@/lib/reports-server';
import { currentBranch } from '@/lib/branches';
import ReportsView from '@/components/Reports';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const ctx = await requirePageContext();
  const isAdmin = ctx.role === 'OWNER' || ctx.role === 'ADMIN';
  const defs = (Object.keys(REPORTS) as ReportKey[]).filter((k) => mayRun(ctx.org, ctx.role, k)).map((k) => ({ key: k, title: REPORTS[k].title, description: REPORTS[k].description }));
  const { branches, branch } = await currentBranch(ctx);
  const [schedules, members] = isAdmin ? await Promise.all([
    ctx.tdb.reportSchedule.findMany({ orderBy: { createdAt: 'asc' } }),
    db.membership.findMany({ where: { organizationId: ctx.org.id }, include: { user: { select: { id: true, name: true, email: true } } } }),
  ]) : [[], []];
  const who = new Map(members.map((m) => [m.userId, m.user.name ?? m.user.email]));
  return (
    <>
      <h1>Reports</h1>
      <p className="lede">Placements, margin, hours, funnel, sources and time to fill for any period — download as CSV or have them emailed every week or month.</p>
      <ReportsView defs={defs} today={localDate(new Date(), ctx.org.timezone)} branches={branches} current={branch?.id ?? null} isAdmin={isAdmin}
        team={members.map((m) => ({ id: m.userId, name: m.user.name ?? m.user.email, admin: m.role === 'OWNER' || m.role === 'ADMIN' }))}
        schedules={schedules.map((s) => ({ id: s.id, report: s.report, frequency: s.frequency, recipients: s.userIds.map((u) => who.get(u) ?? 'former teammate'), branch: s.branchId ? branches.find((b) => b.id === s.branchId)?.name ?? null : null }))} />
    </>
  );
}
