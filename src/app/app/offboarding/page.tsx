import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { isAdmin } from '@/lib/people';
import { templateOf } from '@/lib/offboarding';
import Offboarding, { type Leaver } from '@/components/Offboarding';
import Gate from '@/components/Gate';

export const dynamic = 'force-dynamic';
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export default async function OffboardingPage({ searchParams }: { searchParams: { show?: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'people')) return <Gate title="Offboarding" feature="Employee records" />;
  const all = searchParams.show === 'all';
  const since = new Date(Date.now() - 120 * 864e5);
  const people = await ctx.tdb.employee.findMany({
    where: { OR: [{ offboarding: { some: { doneAt: null } } }, ...(all ? [{ offboarding: { some: {} } }] : [{ endDate: { gte: since } }])] },
    include: { candidate: { select: { id: true, name: true } }, department: { select: { name: true } }, offboarding: { orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] } },
    orderBy: { endDate: 'asc' },
  });
  const leavers: Leaver[] = people.filter((p) => p.endDate).map((p) => ({
    id: p.id, candidateId: p.candidate.id, name: p.candidate.name, title: p.title, department: p.department?.name ?? null, lastDay: ymd(p.endDate!), reason: p.endReason, status: p.status,
    tasks: p.offboarding.map((t) => ({ id: t.id, title: t.title, owner: t.owner, dueDate: t.dueDate ? ymd(t.dueDate) : null, done: !!t.doneAt, note: t.note })),
  }));
  const open = leavers.filter((l) => l.tasks.some((t) => !t.done));
  return (
    <>
      <h1>Offboarding</h1>
      <p className="lede">When you end someone’s employment, their checklist starts here: final paycheck (dated by your state’s rule where we know it), equipment, access, exit interview and benefits. Their later shifts are already off the schedule.</p>
      <div className="kpis">
        <div className="kpi"><b>{open.length}</b><span>Departures with open tasks</span></div>
        <div className="kpi"><b className={open.some((l) => l.tasks.some((t) => !t.done && t.dueDate && t.dueDate < ymd(new Date()))) ? 'warnnum' : undefined}>{leavers.reduce((n, l) => n + l.tasks.filter((t) => !t.done && t.dueDate && t.dueDate < ymd(new Date())).length, 0)}</b><span>Overdue tasks</span></div>
        <div className="kpi"><b>{leavers.filter((l) => l.lastDay > ymd(new Date())).length}</b><span>Leaving soon</span></div>
      </div>
      <Offboarding leavers={leavers} template={templateOf(ctx.org)} all={all} canEdit={canEdit(ctx) && ctx.role !== 'VIEWER'} admin={isAdmin(ctx.role) && canEdit(ctx)} today={ymd(new Date())} />
    </>
  );
}
