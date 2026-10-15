import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { saveManagerReview, shareReview, type Question } from '@/lib/reviews';

type Ctx = { params: { id: string } };
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** One review: questions, the employee's self review once submitted, and the manager review. HR (recruiter role) and up. */
export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb } = await requireApiContext({ minRole: 'RECRUITER', feature: 'reviews' });
  const r = await tdb.review.findFirst({ where: { id: params.id }, include: { cycle: true, employee: { include: { candidate: { select: { name: true } } } } } });
  if (!r) throw new HttpError(404, 'That review was deleted.');
  const goals = await tdb.goal.findMany({ where: { employeeId: r.employeeId }, orderBy: [{ status: 'asc' }, { createdAt: 'asc' }] });
  return Response.json({
    id: r.id, employeeId: r.employeeId, employee: r.employee.candidate.name, title: r.employee.title,
    cycle: { id: r.cycle.id, name: r.cycle.name, status: r.cycle.status, selfReview: r.cycle.selfReview, questions: r.cycle.questions as Question[], dueDate: ymd(r.cycle.dueDate) },
    // Drafts of the self review stay private until the employee submits.
    self: r.selfSubmittedAt ? r.selfAnswers : null, selfSubmittedAt: r.selfSubmittedAt?.toISOString() ?? null,
    manager: r.managerAnswers, rating: r.rating, summary: r.summary, managerSubmittedAt: r.managerSubmittedAt?.toISOString() ?? null,
    sharedAt: r.sharedAt?.toISOString() ?? null, acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null, employeeComment: r.employeeComment,
    goals: goals.map((g) => ({ id: g.id, title: g.title, details: g.details, dueDate: ymd(g.dueDate), progress: g.progress, status: g.status })),
  });
});

/** Save (or submit) the manager review. */
export const PUT = withApi(async (req: Request, { params }: Ctx) => {
  const ctx = await requireApiContext({ minRole: 'RECRUITER', feature: 'reviews', write: true });
  return Response.json(await saveManagerReview(ctx, params.id, await req.json().catch(() => null)));
});

/** Share the submitted manager review with the employee (on their page). */
export const POST = withApi(async (_req: Request, { params }: Ctx) => {
  const ctx = await requireApiContext({ minRole: 'RECRUITER', feature: 'reviews', write: true });
  return Response.json(await shareReview(ctx, params.id));
});
