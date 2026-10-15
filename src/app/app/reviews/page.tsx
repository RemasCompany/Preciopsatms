import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature, planIncludes } from '@/lib/plans';
import { isAdmin } from '@/lib/people';
import { DEFAULT_QUESTIONS } from '@/lib/reviews';
import Reviews, { type CycleRow, type ReviewRow } from '@/components/Reviews';
import Gate from '@/components/Gate';

export const dynamic = 'force-dynamic';
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export default async function ReviewsPage({ searchParams }: { searchParams: { cycle?: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'reviews')) return <Gate title="Reviews & goals" feature="Performance reviews and goals" off={planIncludes(ctx.org, 'reviews') && ctx.org.kind !== 'EMPLOYER'} />;
  if (ctx.role === 'VIEWER') return <><h1>Reviews & goals</h1><div className="card empty"><b>Reviews are private</b>Ask an owner or admin for access.</div></>;
  const { tdb } = ctx;
  const cycles = await tdb.reviewCycle.findMany({ orderBy: [{ status: 'desc' }, { createdAt: 'desc' }], include: { reviews: { select: { selfSubmittedAt: true, managerSubmittedAt: true, sharedAt: true, acknowledgedAt: true } } } });
  const current = cycles.find((c) => c.id === searchParams.cycle) ?? cycles[0] ?? null;
  const [reviews, departments] = await Promise.all([
    current ? tdb.review.findMany({ where: { cycleId: current.id }, include: { employee: { include: { candidate: { select: { name: true } }, department: { select: { name: true } }, manager: { select: { candidate: { select: { name: true } } } }, goals: { where: { status: 'OPEN' }, select: { id: true } } } } }, orderBy: { employee: { candidate: { name: 'asc' } } } }) : [],
    tdb.department.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const cycleRows: CycleRow[] = cycles.map((c) => ({
    id: c.id, name: c.name, status: c.status as 'OPEN' | 'CLOSED', selfReview: c.selfReview, periodStart: ymd(c.periodStart), periodEnd: ymd(c.periodEnd), dueDate: ymd(c.dueDate),
    total: c.reviews.length, self: c.reviews.filter((r) => r.selfSubmittedAt).length, manager: c.reviews.filter((r) => r.managerSubmittedAt).length, shared: c.reviews.filter((r) => r.sharedAt).length, acknowledged: c.reviews.filter((r) => r.acknowledgedAt).length,
  }));
  const rows: ReviewRow[] = reviews.map((r) => ({
    id: r.id, employeeId: r.employeeId, name: r.employee.candidate.name, title: r.employee.title, department: r.employee.department?.name ?? null, manager: r.employee.manager?.candidate.name ?? null,
    self: !!r.selfSubmittedAt, managerDraft: !!r.managerAnswers && !r.managerSubmittedAt, manager_: !!r.managerSubmittedAt, shared: !!r.sharedAt, acknowledged: !!r.acknowledgedAt, rating: r.rating, goals: r.employee.goals.length,
  }));
  return (
    <>
      <h1>{ctx.org.kind === 'EMPLOYER' ? 'Reviews & goals' : 'Staff reviews'}</h1>
      <p className="lede">Run a review cycle: employees answer a self review on their employee page, you write the manager review and share it, and they acknowledge it there. Set goals they can update as they go.</p>
      <Reviews cycles={cycleRows} current={current?.id ?? null} rows={rows} departments={departments} defaults={DEFAULT_QUESTIONS.map((q) => ({ text: q.text, kind: q.kind }))}
        canEdit={canEdit(ctx)} admin={isAdmin(ctx.role) && canEdit(ctx)} today={ymd(new Date())} />
    </>
  );
}
