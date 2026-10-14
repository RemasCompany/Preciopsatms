import { z } from 'zod';
import type { Organization, Role, TrainingCourse, TrainingEnrollment, User } from '@prisma/client';
import { HttpError, logActivity, tenantDb, type TenantDb } from './tenant';
import { hasFeature } from './plans';
import { newToken, sha256 } from './tokens';
import { deliver, type Channel } from './schedule-server';
import { audit } from './audit';
import { localDate } from './timeclock';
import { dayLabel } from './schedule';
import {
  AnswersBody, CourseBody, OPEN_STATUSES, RECERT_WINDOW_DAYS, REFRESHER_TRIGGERS, grade, recertDate,
  type CourseInput, type Lesson, type Question, type Status,
} from './training';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';
const fmt = (s: string) => dayLabel(s, { month: 'short', day: 'numeric', year: 'numeric' });
const isAdmin = (r: Role) => r === 'OWNER' || r === 'ADMIN';
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a full date.');
const CHANNELS = z.array(z.enum(['sms', 'email'])).max(2).default([]);

// ---- courses ----

export function parseCourse(body: unknown) {
  const r = CourseBody.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Check the course and try again.');
  return { ...r.data, prerequisite: r.data.prerequisite || null, description: r.data.description || null, lessons: r.data.lessons.map((l) => ({ title: l.title, body: l.body, videoUrl: l.videoUrl || null })) };
}

export async function saveCourse(tdb: TenantDb, org: Organization, user: User, body: unknown, id?: string) {
  const c = parseCourse(body);
  if (id) {
    const old = await tdb.trainingCourse.findFirst({ where: { id } });
    if (!old) throw new HttpError(404, 'That course was deleted.');
    await tdb.trainingCourse.updateMany({ where: { id }, data: c });
  }
  const saved = id ? (await tdb.trainingCourse.findFirst({ where: { id } }))! : await tdb.trainingCourse.create({ data: c as never });
  await audit(org.id, user, 'training.course', `${id ? 'Updated' : 'Added'} the course “${c.title}”`, { targetType: 'trainingCourse', targetId: saved.id });
  return saved;
}

/** Courses with history are archived (their records must stay); unused ones are deleted. */
export async function removeCourse(tdb: TenantDb, org: Organization, user: User, id: string) {
  const c = await tdb.trainingCourse.findFirst({ where: { id } });
  if (!c) throw new HttpError(404, 'That course was already removed.');
  if (await tdb.trainingEnrollment.count({ where: { courseId: id, status: { in: OPEN_STATUSES } } })) throw new HttpError(409, 'Some workers are still taking this course. Cancel their training first.');
  const used = await tdb.trainingEnrollment.count({ where: { courseId: id } });
  if (used) await tdb.trainingCourse.updateMany({ where: { id }, data: { archived: true } });
  else await tdb.trainingCourse.deleteMany({ where: { id } });
  await audit(org.id, user, 'training.course', `${used ? 'Archived' : 'Deleted'} the course “${c.title}”`, { targetType: 'trainingCourse', targetId: id });
  return { archived: !!used };
}

// ---- assigning ----

export const AssignBody = z.object({
  courseId: z.string().min(1, 'Choose a course.'),
  candidateIds: z.array(z.string()).min(1, 'Choose at least one worker.').max(200, 'Assign up to 200 workers at a time.'),
  reason: z.enum(['initial', 'recert']).default('initial'),
  dueDate: DATE.nullable().optional(),
  channels: CHANNELS,
});

async function invite(tdb: TenantDb, org: Organization, user: User, e: TrainingEnrollment, course: TrainingCourse, channels: Channel[]) {
  if (!channels.length) return [];
  const c = await tdb.candidate.findFirst({ where: { id: e.candidateId }, select: { id: true, name: true, email: true, phone: true, emailOptOut: true, smsOptOut: true } });
  if (!c) return [];
  const token = newToken();
  const until = Math.max(Date.now() + 45 * 864e5, e.dueDate ? e.dueDate.getTime() + 14 * 864e5 : 0);
  await tdb.workerLink.create({ data: { candidateId: c.id, tokenHash: sha256(token), kind: 'training', expiresAt: new Date(until) } as never });
  const link = `${appUrl()}/shifts/${token}`, company = org.shortName ?? org.name, first = c.name.split(' ')[0] || 'there';
  const due = e.dueDate ? ` by ${fmt(ymd(e.dueDate))}` : '';
  const what = e.reason === 'refresher' ? 'refresher training' : e.reason === 'recert' ? 'recertification training' : 'training';
  const msg = (ch: Channel) => ch === 'sms'
    ? { subject: '', text: `${company}: please complete your ${course.title} ${what}${due}. Lessons and a short quiz on your phone: ${link}` }
    : { subject: `${company}: ${course.title} ${what}`, text: `Hi ${first},\n\nPlease complete your ${course.title} ${what}${due}. Read the lessons and take the short quiz on your phone:\n\n${link}\n\nAfter you pass, a trainer will meet you for hands-on practice and an evaluation on the equipment. You’re not certified until that’s done.\n\nThis link is just for you, so please don’t share it.\n\nThank you,\n${company}` };
  const problems: string[] = [];
  let sent = false;
  for (const ch of channels) {
    const p = await deliver(tdb, c, ch, msg(ch), { name: company, replyTo: user.email }, user.id);
    if (p) problems.push(`${c.name} (${ch === 'sms' ? 'text' : 'email'}): ${p}`); else sent = true;
  }
  if (sent) await tdb.trainingEnrollment.updateMany({ where: { id: e.id }, data: { invitedAt: new Date() } });
  return problems;
}

/** Assigns a course to workers. Anyone already taking it is skipped. Each worker gets one message per chosen channel. */
export async function assign(org: Organization, user: User, body: unknown) {
  const b = AssignBody.parse(body);
  const tdb = tenantDb(org.id);
  const course = await tdb.trainingCourse.findFirst({ where: { id: b.courseId, archived: false } });
  if (!course) throw new HttpError(404, 'That course was archived or deleted.');
  const cands = await tdb.candidate.findMany({ where: { id: { in: b.candidateIds } }, select: { id: true, name: true } });
  const open = await tdb.trainingEnrollment.findMany({ where: { courseId: course.id, candidateId: { in: cands.map((c) => c.id) }, status: { in: OPEN_STATUSES } }, select: { candidateId: true } });
  const skip = new Set(open.map((o) => o.candidateId));
  const problems: string[] = [];
  let assigned = 0;
  for (const c of cands) {
    if (skip.has(c.id)) continue;
    const e = await tdb.trainingEnrollment.create({ data: { courseId: course.id, candidateId: c.id, reason: b.reason, dueDate: b.dueDate ? day(b.dueDate) : null, assignedById: user.id } as never });
    assigned++;
    problems.push(...await invite(tdb, org, user, e, course, b.channels));
  }
  if (assigned) await logActivity(org.id, `Assigned ${course.title} to ${assigned} worker${assigned === 1 ? '' : 's'}`, user.id);
  return { assigned, skipped: skip.size, problems };
}

export const RefresherBody = z.object({
  candidateId: z.string().min(1), courseId: z.string().min(1, 'Choose the course they need to retake.'),
  trigger: z.enum(REFRESHER_TRIGGERS, { errorMap: () => ({ message: 'Choose why refresher training is needed.' }) }),
  note: z.string().trim().max(500).optional(), channels: CHANNELS,
});

/** Requires refresher training. Until they pass a new evaluation, their certification doesn't count. */
export async function requireRefresher(org: Organization, user: User, body: unknown) {
  const b = RefresherBody.parse(body);
  const tdb = tenantDb(org.id);
  const [course, c] = await Promise.all([tdb.trainingCourse.findFirst({ where: { id: b.courseId, archived: false } }), tdb.candidate.findFirst({ where: { id: b.candidateId }, select: { id: true, name: true } })]);
  if (!course || !c) throw new HttpError(404, 'That worker or course was deleted.');
  const trigger = `${b.trigger}${b.note ? `: ${b.note}` : ''}`;
  await tdb.trainingEnrollment.updateMany({ where: { courseId: course.id, candidateId: c.id, status: { in: OPEN_STATUSES } }, data: { status: 'cancelled' } });
  const e = await tdb.trainingEnrollment.create({ data: { courseId: course.id, candidateId: c.id, reason: 'refresher', trigger, assignedById: user.id } as never });
  const text = `${c.name} needs ${course.title} refresher training (${trigger}); their ${course.certType} certification is on hold until they pass a new evaluation`;
  await logActivity(org.id, text, user.id);
  await audit(org.id, user, 'training.certify', text, { targetType: 'candidate', targetId: c.id });
  return { id: e.id, problems: await invite(tdb, org, user, e, course, b.channels) };
}

export async function resend(org: Organization, user: User, id: string, channels: Channel[]) {
  const tdb = tenantDb(org.id);
  const e = await tdb.trainingEnrollment.findFirst({ where: { id, status: 'assigned' }, include: { course: true } });
  if (!e) throw new HttpError(409, 'Only workers still taking the course can be sent a new link.');
  if (!channels.length) throw new HttpError(400, 'Choose text, email or both.');
  const problems = await invite(tdb, org, user, e, e.course, channels);
  return { sent: problems.length < channels.length, problems };
}

export async function cancel(org: Organization, user: User, id: string) {
  const tdb = tenantDb(org.id);
  const e = await tdb.trainingEnrollment.findFirst({ where: { id, status: { in: OPEN_STATUSES } }, include: { course: { select: { title: true } }, candidate: { select: { name: true } } } });
  if (!e) throw new HttpError(409, 'That training is already finished or cancelled.');
  await tdb.trainingEnrollment.updateMany({ where: { id }, data: { status: 'cancelled' } });
  await logActivity(org.id, `Cancelled ${e.candidate.name}’s ${e.course.title} training`, user.id);
}

// ---- the hands-on evaluation ----

export const EvaluateBody = z.object({
  trainedAt: DATE, evaluatedAt: DATE,
  evaluatorName: z.string().trim().min(2, 'Enter the evaluator’s name.').max(120),
  evaluatorTitle: z.string().trim().min(2, 'Enter the evaluator’s role or qualification (e.g. “Certified forklift trainer”).').max(160),
  equipment: z.string().trim().min(2, 'Enter the equipment they were evaluated on (make, model or type).').max(160),
  checklist: z.array(z.object({ item: z.string().max(200), pass: z.boolean() })).min(1),
  passed: z.boolean(),
  notes: z.string().trim().max(2000).optional(),
});

/** Records the practical training and evaluation. A pass issues (or renews) the certification as a verified credential. */
export async function evaluate(org: Organization, user: User, id: string, body: unknown) {
  const b = EvaluateBody.parse(body);
  const tdb = tenantDb(org.id);
  const today = localDate(new Date(), org.timezone);
  if (b.evaluatedAt > today || b.trainedAt > today) throw new HttpError(400, 'Training and evaluation dates can’t be in the future.');
  if (b.trainedAt > b.evaluatedAt) throw new HttpError(400, 'The hands-on training has to happen on or before the evaluation.');
  const e = await tdb.trainingEnrollment.findFirst({ where: { id }, include: { course: true, candidate: { select: { id: true, name: true } } } });
  if (!e) throw new HttpError(404, 'That training was deleted.');
  if (e.status !== 'evaluation') throw new HttpError(409, e.status === 'assigned' ? `${e.candidate.name} has to pass the online quiz first.` : 'This evaluation was already recorded.');
  const expected = e.course.checklist as string[];
  if (b.checklist.length !== expected.length || b.checklist.some((x, i) => x.item !== expected[i])) throw new HttpError(409, 'The course’s checklist changed. Reload the page and try again.');
  if (b.passed && b.checklist.some((x) => !x.pass)) throw new HttpError(400, 'Every checklist item must pass to certify. Record it as not passed and assign more training.');
  // e.g. cranes: the employer evaluation only counts on top of a current accredited certification.
  if (b.passed && e.course.prerequisite) {
    const missing = await certGaps(tdb, e.candidateId, [e.course.prerequisite], b.evaluatedAt, today);
    if (missing.length) throw new HttpError(409, `${e.candidate.name} needs a current ${e.course.prerequisite} on file before they can be certified here (${missing[0].split(': ').slice(1).join(': ')}). Add it under Credentials on their record, then record the evaluation.`);
  }
  const record = { trainedAt: day(b.trainedAt), evaluatedAt: day(b.evaluatedAt), evaluatorName: b.evaluatorName, evaluatorTitle: b.evaluatorTitle, equipment: b.equipment, checklist: b.checklist, evalNotes: b.notes || null, recordedById: user.id };

  if (!b.passed) {
    await tdb.trainingEnrollment.updateMany({ where: { id }, data: { ...record, status: 'failed' } });
    const text = `${e.candidate.name} didn’t pass the ${e.course.title} evaluation (${b.evaluatorName}, ${fmt(b.evaluatedAt)})`;
    await logActivity(org.id, text, user.id);
    await audit(org.id, user, 'training.certify', text, { targetType: 'candidate', targetId: e.candidateId });
    return { certified: false };
  }
  const expires = recertDate(b.evaluatedAt, e.course.recertMonths);
  const cred = {
    issuedAt: day(b.evaluatedAt), expiresAt: day(expires), verifiedAt: new Date(), verifiedById: user.id, verifyMethod: 'Other',
    verifyNote: `Training and evaluation recorded in Preciops: ${e.course.title}; evaluated by ${b.evaluatorName} (${b.evaluatorTitle}) on ${b.equipment}.`, alertedLevel: null,
  };
  // Renew the existing certification rather than piling up expired copies.
  const existing = await tdb.credential.findFirst({ where: { candidateId: e.candidateId, type: e.course.certType }, orderBy: { createdAt: 'desc' } });
  const credentialId = existing ? (await tdb.credential.updateMany({ where: { id: existing.id }, data: cred }), existing.id)
    : (await tdb.credential.create({ data: { candidateId: e.candidateId, type: e.course.certType, ...cred } as never })).id;
  await tdb.trainingEnrollment.updateMany({ where: { id }, data: { ...record, status: 'certified', certifiedAt: new Date(), expiresAt: day(expires), credentialId } });
  const text = `${e.candidate.name} certified: ${e.course.certType} until ${fmt(expires)} (evaluated by ${b.evaluatorName})`;
  await logActivity(org.id, text, user.id);
  await audit(org.id, user, 'training.certify', text, { targetType: 'candidate', targetId: e.candidateId });
  return { certified: true, expiresAt: expires };
}

// ---- is someone certified for a job? ----

/**
 * What's missing for each required certification, as text a recruiter can act on. A certification counts when it's
 * verified, lasts through `through`, and isn't on hold for refresher training or a failed evaluation since it was issued.
 */
export async function certGaps(tdb: TenantDb, candidateId: string, required: string[], through: string, today: string) {
  if (!required.length) return [];
  const [creds, holds] = await Promise.all([
    tdb.credential.findMany({ where: { candidateId, type: { in: required } }, orderBy: { expiresAt: 'desc' } }),
    tdb.trainingEnrollment.findMany({ where: { candidateId, course: { certType: { in: required } }, OR: [{ reason: 'refresher', status: { in: OPEN_STATUSES } }, { status: 'failed' }] }, include: { course: { select: { certType: true } } }, orderBy: { createdAt: 'desc' } }),
  ]);
  const out: string[] = [];
  for (const type of required) {
    const c = creds.find((x) => x.type === type);
    const exp = c?.expiresAt ? ymd(c.expiresAt) : null;
    const issued = c?.issuedAt ?? c?.verifiedAt ?? null;
    const hold = c && holds.find((h) => h.course.certType === type && (!issued || (h.evaluatedAt ?? h.createdAt) >= issued));
    if (!c) out.push(`${type}: not certified`);
    else if (!c.verifiedAt) out.push(`${type}: not verified`);
    else if (!exp) out.push(`${type}: no expiration date on file`);
    else if (exp < through) out.push(`${type}: ${exp < today ? `expired ${fmt(exp)}` : `expires ${fmt(exp)}, before ${fmt(through)}`}`);
    else if (hold) out.push(`${type}: on hold — ${hold.status === 'failed' ? 'failed an evaluation' : `refresher training required (${hold.trigger ?? 'see training record'})`}`);
  }
  return out;
}

/**
 * Stops an offer, placement or shift for someone missing a job's required certification, unless an owner or admin
 * gives a reason to go ahead. Overrides are written to the audit log.
 */
export async function enforceCerts(
  ctx: { tdb: TenantDb; org: Organization; user: User; role: Role },
  candidate: { id: string; name: string }, job: { id: string; title: string; requiredCerts: string[] },
  action: string, through: string, override?: string | null,
) {
  if (!hasFeature(ctx.org, 'training') || !job.requiredCerts.length) return;
  const gaps = await certGaps(ctx.tdb, candidate.id, job.requiredCerts, through, localDate(new Date(), ctx.org.timezone));
  if (!gaps.length) return;
  const why = override?.trim();
  const can = isAdmin(ctx.role);
  if (!why) throw new HttpError(409, `${candidate.name} isn’t certified for ${job.title}: ${gaps.join('; ')}. ${can ? 'Give a reason to continue anyway.' : 'Assign training on the Training page, or ask an owner or admin to override.'}`, { certOverride: true, canOverride: can, gaps });
  if (!can) throw new HttpError(403, 'Only an owner or admin can override a missing certification.');
  if (why.length < 5) throw new HttpError(400, 'Give a reason for the override (at least a few words).');
  const text = `Overrode missing certification to ${action} ${candidate.name} (${job.title}): ${gaps.join('; ')}. Reason: ${why.slice(0, 300)}`;
  await logActivity(ctx.org.id, text, ctx.user.id);
  await audit(ctx.org.id, ctx.user, 'training.override', text, { targetType: 'candidate', targetId: candidate.id });
}

/** Sets which certifications a job needs (admins only — this controls the warnings). */
export async function setJobCerts(tdb: TenantDb, org: Organization, user: User, jobId: string, certs: string[]) {
  const job = await tdb.job.findFirst({ where: { id: jobId }, select: { id: true, title: true, requiredCerts: true } });
  if (!job) throw new HttpError(404, 'That job was deleted.');
  await tdb.job.updateMany({ where: { id: jobId }, data: { requiredCerts: [...new Set(certs)] } });
  await audit(org.id, user, 'training.course', `Set required certifications for ${job.title}: ${certs.join(', ') || 'none'}`, { targetType: 'job', targetId: jobId, changes: { requiredCerts: [job.requiredCerts, certs] } });
}

// ---- lists for the Training page ----

/** Certified operators due for recertification within the window (or already expired), with no recertification under way. */
export async function recertDue(tdb: TenantDb, today: string) {
  const courses = await tdb.trainingCourse.findMany({ where: { archived: false }, select: { id: true, title: true, certType: true } });
  if (!courses.length) return [];
  const types = [...new Set(courses.map((c) => c.certType))];
  const until = new Date(day(today).getTime() + RECERT_WINDOW_DAYS * 864e5);
  const creds = await tdb.credential.findMany({ where: { type: { in: types }, expiresAt: { lte: until } }, include: { candidate: { select: { id: true, name: true } } }, orderBy: { expiresAt: 'asc' } });
  const open = await tdb.trainingEnrollment.findMany({ where: { candidateId: { in: creds.map((c) => c.candidateId) }, status: { in: OPEN_STATUSES } }, select: { candidateId: true, course: { select: { certType: true } } } });
  return creds.filter((c) => !open.some((o) => o.candidateId === c.candidateId && o.course.certType === c.type)).map((c) => ({
    credentialId: c.id, candidateId: c.candidateId, name: c.candidate.name, certType: c.type, expiresAt: ymd(c.expiresAt!),
    expired: ymd(c.expiresAt!) < today, courseId: courses.find((x) => x.certType === c.type)!.id,
  }));
}

// ---- the worker's side (from their private link) ----

type Link = { organizationId: string; candidateId: string; candidate: { name: string } };

/** Open training and anything certified in the last 30 days. Quiz answers are never included. */
export async function workerTraining(orgId: string, candidateId: string) {
  const rows = await tenantDb(orgId).trainingEnrollment.findMany({
    where: { candidateId, OR: [{ status: { in: OPEN_STATUSES } }, { status: 'certified', certifiedAt: { gte: new Date(Date.now() - 30 * 864e5) } }] },
    include: { course: true }, orderBy: { createdAt: 'asc' },
  });
  return rows.map((e) => ({
    id: e.id, title: e.course.title, description: e.course.description, status: e.status as Status, reason: e.reason,
    dueDate: e.dueDate ? ymd(e.dueDate) : null, passScore: e.course.passScore, quizScore: e.quizScore, attempts: e.quizAttempts,
    lessons: (e.course.lessons as Lesson[]).map((l) => ({ title: l.title, body: l.body, videoUrl: l.videoUrl ?? null })),
    lessonsDone: e.lessonsDone,
    questions: e.status === 'assigned' ? (e.course.questions as Question[]).map((q) => ({ q: q.q, choices: q.choices })) : [],
    expiresAt: e.expiresAt ? ymd(e.expiresAt) : null, certType: e.course.certType,
  }));
}

async function mine(link: Link, enrollmentId: string) {
  const tdb = tenantDb(link.organizationId);
  const e = await tdb.trainingEnrollment.findFirst({ where: { id: enrollmentId, candidateId: link.candidateId }, include: { course: true } });
  if (!e) throw new HttpError(404, 'That training isn’t on your list.');
  if (e.status !== 'assigned') throw new HttpError(409, e.status === 'evaluation' ? 'You already passed the quiz. Your trainer will set up your hands-on evaluation.' : 'This training is closed.');
  return { tdb, e };
}

export async function markLesson(link: Link, enrollmentId: string, index: number) {
  const { tdb, e } = await mine(link, enrollmentId);
  if (!Number.isInteger(index) || index < 0 || index >= (e.course.lessons as Lesson[]).length) throw new HttpError(400, 'That lesson isn’t in this course.');
  if (!e.lessonsDone.includes(index)) await tdb.trainingEnrollment.updateMany({ where: { id: e.id }, data: { lessonsDone: [...e.lessonsDone, index].sort((a, b) => a - b) } });
  return { ok: true };
}

/** Grades the quiz on the server. Passing moves the worker on to the hands-on evaluation. */
export async function submitQuiz(link: Link, enrollmentId: string, body: unknown) {
  const { answers } = AnswersBody.parse(body);
  const { tdb, e } = await mine(link, enrollmentId);
  const lessons = e.course.lessons as Lesson[], questions = e.course.questions as Question[];
  if (e.lessonsDone.length < lessons.length) throw new HttpError(409, 'Finish every lesson before taking the quiz.');
  if (answers.length !== questions.length || answers.some((a) => a === null)) throw new HttpError(400, 'Answer every question.');
  const r = grade(questions, answers, e.course.passScore);
  await tdb.trainingEnrollment.updateMany({ where: { id: e.id, status: 'assigned' }, data: { quizAttempts: { increment: 1 }, quizScore: Math.max(r.score, e.quizScore ?? 0), ...(r.passed ? { status: 'evaluation', quizPassedAt: new Date() } : {}) } });
  if (r.passed) await logActivity(link.organizationId, `${link.candidate.name} passed the ${e.course.title} quiz (${r.score}%) and is ready for a hands-on evaluation`);
  return { score: r.score, passed: r.passed, passScore: e.course.passScore, wrong: r.wrong };
}
