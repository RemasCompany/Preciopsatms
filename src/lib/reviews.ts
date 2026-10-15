import { z } from 'zod';
import type { Organization, Role, User } from '@prisma/client';
import { HttpError, logActivity, type TenantDb } from './tenant';
import { audit } from './audit';

/**
 * Performance reviews and goals. A cycle asks the same questions of everyone in it. Employees answer their self
 * review on their own page; HR or a manager writes the manager review and shares it; the employee acknowledges it.
 */
type Ctx = { tdb: TenantDb; org: Organization; user: User; role: Role };
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date.');

export type Question = { id: string; text: string; kind: 'rating' | 'text' };
export type Answers = Record<string, { rating?: number; text?: string }>;
export const DEFAULT_QUESTIONS: Question[] = [
  { id: 'q1', text: 'Quality of work', kind: 'rating' },
  { id: 'q2', text: 'Reliability and attendance', kind: 'rating' },
  { id: 'q3', text: 'Teamwork and communication', kind: 'rating' },
  { id: 'q4', text: 'Safety and following procedures', kind: 'rating' },
  { id: 'q5', text: 'What went well this period?', kind: 'text' },
  { id: 'q6', text: 'What should improve, and how?', kind: 'text' },
];
export const RATING = ['', 'Needs improvement', 'Developing', 'Meets expectations', 'Exceeds expectations', 'Outstanding'];

export const CycleBody = z.object({
  name: z.string().trim().min(2, 'Name the cycle (e.g. 2026 annual review).').max(80),
  periodStart: DATE, periodEnd: DATE, dueDate: DATE,
  selfReview: z.boolean().default(true),
  questions: z.array(z.object({ text: z.string().trim().min(2, 'Every question needs text.').max(200), kind: z.enum(['rating', 'text']) })).min(1, 'Add at least one question.').max(15, 'Use up to 15 questions.').optional(),
  departmentId: z.string().optional().nullable(),
});
const AnswerBody = z.object({ answers: z.record(z.object({ rating: z.number().int().min(1).max(5).optional(), text: z.string().max(3000, 'Keep each answer under 3,000 characters.').optional() })).default({}), submit: z.boolean().default(false) });
export const ManagerBody = AnswerBody.extend({ rating: z.number().int().min(1).max(5).nullable().optional(), summary: z.string().trim().max(3000).nullable().optional() });
export const GoalBody = z.object({
  title: z.string().trim().min(2, 'Describe the goal.').max(200), details: z.string().trim().max(2000).nullable().optional(),
  dueDate: DATE.nullable().optional(), progress: z.number().int().min(0).max(100).optional(), status: z.enum(['OPEN', 'DONE', 'DROPPED']).optional(),
});

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Check the form and try again.');
  return r.data;
}

/** Keeps only answers to this cycle's questions, of the right kind; submitting needs every question answered. */
function clean(questions: Question[], raw: Answers, submit: boolean) {
  const out: Answers = {};
  for (const q of questions) {
    const a = raw[q.id];
    if (q.kind === 'rating' && a?.rating) out[q.id] = { rating: a.rating };
    if (q.kind === 'text' && a?.text?.trim()) out[q.id] = { text: a.text.trim() };
  }
  const missing = questions.find((q) => !out[q.id]);
  if (submit && missing) throw new HttpError(400, `Answer “${missing.text}” before submitting.`);
  return out;
}

export async function startCycle(ctx: Ctx, body: unknown) {
  const b = parse(CycleBody, body);
  if (b.periodEnd < b.periodStart) throw new HttpError(400, 'The period ends before it starts.');
  const questions: Question[] = (b.questions ?? DEFAULT_QUESTIONS).map((q, i) => ({ id: `q${i + 1}`, text: q.text, kind: q.kind }));
  const { tdb, org, user } = ctx;
  if (b.departmentId && !(await tdb.department.findFirst({ where: { id: b.departmentId } }))) throw new HttpError(404, 'That department was deleted.');
  const c = await tdb.reviewCycle.create({ data: { name: b.name, periodStart: day(b.periodStart), periodEnd: day(b.periodEnd), dueDate: day(b.dueDate), selfReview: b.selfReview, questions, createdById: user.id } as never });
  const added = await addPeople(tdb, org.id, c.id, b.periodEnd, b.departmentId ?? null);
  await audit(org.id, user, 'review.cycle', `Started the ${b.name} review cycle (${added} employee${added === 1 ? '' : 's'})`, { targetType: 'ReviewCycle', targetId: c.id });
  return { id: c.id, added };
}

/** Everyone current who started by the end of the period, and isn't in the cycle yet. */
async function addPeople(tdb: TenantDb, orgId: string, cycleId: string, periodEnd: string, departmentId: string | null) {
  const people = await tdb.employee.findMany({ where: { status: { not: 'TERMINATED' }, startDate: { lte: day(periodEnd) }, ...(departmentId ? { departmentId } : {}), reviews: { none: { cycleId } } }, select: { id: true } });
  if (people.length) await tdb.review.createMany({ data: people.map((p) => ({ organizationId: orgId, cycleId, employeeId: p.id })), skipDuplicates: true });
  return people.length;
}

export async function addMissing(ctx: Ctx, cycleId: string) {
  const c = await ctx.tdb.reviewCycle.findFirst({ where: { id: cycleId } });
  if (!c) throw new HttpError(404, 'That review cycle was deleted.');
  if (c.status !== 'OPEN') throw new HttpError(409, 'This cycle is closed.');
  return { added: await addPeople(ctx.tdb, ctx.org.id, c.id, c.periodEnd.toISOString().slice(0, 10), null) };
}

export async function setCycleStatus(ctx: Ctx, cycleId: string, status: 'OPEN' | 'CLOSED') {
  const c = await ctx.tdb.reviewCycle.findFirst({ where: { id: cycleId } });
  if (!c) throw new HttpError(404, 'That review cycle was deleted.');
  await ctx.tdb.reviewCycle.updateMany({ where: { id: c.id }, data: { status, closedAt: status === 'CLOSED' ? new Date() : null } });
  await audit(ctx.org.id, ctx.user, 'review.cycle', `${status === 'CLOSED' ? 'Closed' : 'Reopened'} the ${c.name} review cycle`, { targetType: 'ReviewCycle', targetId: c.id });
}

async function loadReview(tdb: TenantDb, id: string) {
  const r = await tdb.review.findFirst({ where: { id }, include: { cycle: true, employee: { include: { candidate: { select: { name: true } } } } } });
  if (!r) throw new HttpError(404, 'That review was deleted.');
  return r;
}

/** The manager review: saved as a draft, or submitted (every question and an overall rating). Shared separately. */
export async function saveManagerReview(ctx: Ctx, id: string, body: unknown) {
  const b = parse(ManagerBody, body);
  const r = await loadReview(ctx.tdb, id);
  if (r.cycle.status !== 'OPEN') throw new HttpError(409, 'This cycle is closed. Reopen it to make changes.');
  if (r.sharedAt) throw new HttpError(409, 'This review was already shared with the employee.');
  const answers = clean(r.cycle.questions as Question[], b.answers, b.submit);
  if (b.submit && !b.rating) throw new HttpError(400, 'Choose an overall rating before submitting.');
  await ctx.tdb.review.updateMany({ where: { id }, data: { managerAnswers: answers, rating: b.rating ?? null, summary: b.summary || null, reviewerId: ctx.user.id, ...(b.submit ? { managerSubmittedAt: new Date() } : {}) } });
  return { submitted: b.submit };
}

export async function shareReview(ctx: Ctx, id: string) {
  const r = await loadReview(ctx.tdb, id);
  if (!r.managerSubmittedAt) throw new HttpError(409, 'Submit the manager review before sharing it.');
  if (r.sharedAt) return { ok: true };
  await ctx.tdb.review.updateMany({ where: { id }, data: { sharedAt: new Date() } });
  await audit(ctx.org.id, ctx.user, 'review.share', `Shared ${r.employee.candidate.name}’s ${r.cycle.name} review`, { targetType: 'Review', targetId: id });
  await logActivity(ctx.org.id, `Shared ${r.employee.candidate.name}’s ${r.cycle.name} review`, ctx.user.id);
  return { ok: true };
}

/** The employee's own self review, from their page. */
export async function saveSelfReview(tdb: TenantDb, employeeId: string, id: string, body: unknown) {
  const b = parse(AnswerBody, body);
  const r = await tdb.review.findFirst({ where: { id, employeeId }, include: { cycle: true } });
  if (!r) throw new HttpError(404, 'That review isn’t yours.');
  if (!r.cycle.selfReview) throw new HttpError(409, 'This cycle doesn’t have a self review.');
  if (r.cycle.status !== 'OPEN') throw new HttpError(409, 'This review cycle is closed.');
  if (r.selfSubmittedAt) throw new HttpError(409, 'You already submitted your self review.');
  const answers = clean(r.cycle.questions as Question[], b.answers, b.submit);
  await tdb.review.updateMany({ where: { id }, data: { selfAnswers: answers, ...(b.submit ? { selfSubmittedAt: new Date() } : {}) } });
  return { message: b.submit ? 'Submitted. Your manager will see your answers.' : 'Saved. You can finish it later.' };
}

export async function acknowledge(tdb: TenantDb, employeeId: string, id: string, comment: unknown) {
  const text = typeof comment === 'string' ? comment.trim().slice(0, 2000) : '';
  const r = await tdb.review.findFirst({ where: { id, employeeId } });
  if (!r || !r.sharedAt) throw new HttpError(404, 'That review isn’t ready yet.');
  if (r.acknowledgedAt) return { message: 'You already acknowledged this review.' };
  await tdb.review.updateMany({ where: { id }, data: { acknowledgedAt: new Date(), employeeComment: text || null } });
  return { message: 'Thanks — your manager will see that you’ve read it.' };
}

// ---- goals ----
export async function saveGoal(ctx: Ctx, employeeId: string, goalId: string | null, body: unknown) {
  const b = parse(GoalBody, body);
  if (!(await ctx.tdb.employee.findFirst({ where: { id: employeeId } }))) throw new HttpError(404, 'That employee was deleted.');
  const data = { title: b.title, details: b.details || null, dueDate: b.dueDate ? day(b.dueDate) : null, ...(b.progress !== undefined ? { progress: b.progress } : {}), ...(b.status ? { status: b.status, ...(b.status === 'DONE' ? { progress: 100 } : {}) } : {}) };
  if (goalId) {
    const { count } = await ctx.tdb.goal.updateMany({ where: { id: goalId, employeeId }, data });
    if (!count) throw new HttpError(404, 'That goal was deleted.');
    return { id: goalId };
  }
  return { id: (await ctx.tdb.goal.create({ data: { ...data, employeeId, createdById: ctx.user.id } as never })).id };
}

/** Employees update progress on their own goals. */
export async function updateOwnGoal(tdb: TenantDb, employeeId: string, goalId: string, progress: unknown) {
  const p = z.number().int().min(0).max(100).safeParse(progress);
  if (!p.success) throw new HttpError(400, 'Progress is a percentage from 0 to 100.');
  const { count } = await tdb.goal.updateMany({ where: { id: goalId, employeeId, status: 'OPEN' }, data: { progress: p.data, ...(p.data === 100 ? { status: 'DONE' } : {}) } });
  if (!count) throw new HttpError(404, 'That goal isn’t open any more.');
  return { message: p.data === 100 ? 'Marked done. Nice work.' : 'Progress saved.' };
}
