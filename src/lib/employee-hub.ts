import { z } from 'zod';
import type { Employee, Organization, Task } from '@prisma/client';
import { HttpError, logActivity, type TenantDb } from './tenant';
import { hasFeature } from './plans';
import { putFile } from './storage';
import { newToken, sha256 } from './tokens';
import { deliver } from './schedule-server';
import { scoreApplications } from './match-server';

/**
 * The parts of an employee's own page beyond pay and time off: their profile and photo, tasks assigned to them (with
 * updates both ways), jobs posted internally, and training they can sign up for. Everything is scoped to the person
 * behind the private link.
 */
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';
const text = (max: number, label: string) => z.string().trim().max(max, `${label} is too long.`).optional();

// ---- profile ----

export const ProfileBody = z.object({
  preferredName: text(60, 'Preferred name'),
  pronouns: text(30, 'Pronouns'),
  email: z.string().trim().email('Enter a valid email address.').or(z.literal('')).optional(),
  phone: z.string().trim().max(30, 'That phone number is too long.').regex(/^[\d\s()+.-]*$/, 'Use digits for the phone number.').optional(),
  homeAddress: text(300, 'Home address'),
  emergencyName: text(100, 'Emergency contact name'),
  emergencyRelation: text(40, 'Relationship'),
  emergencyPhone: z.string().trim().max(30, 'That phone number is too long.').regex(/^[\d\s()+.-]*$/, 'Use digits for the emergency contact’s phone number.').optional(),
  bio: text(1000, 'About me'),
  skills: z.array(z.string().trim().min(1).max(60)).max(40, 'List up to 40 skills.').optional(),
  certs: z.array(z.string().trim().min(1).max(80)).max(30, 'List up to 30 certifications.').optional(),
});
export type ProfileInput = z.infer<typeof ProfileBody>;

type ProfileState = Pick<Employee, 'preferredName' | 'pronouns' | 'homeAddress' | 'emergencyName' | 'emergencyRelation' | 'emergencyPhone' | 'bio'> & { email: string | null; phone: string | null; photo: boolean; skills: string[] };

/** The steps a complete profile has, in the order the page asks for them. */
export function profileSteps(p: ProfileState) {
  return [
    { key: 'photo', label: 'Profile picture', done: p.photo },
    { key: 'contact', label: 'Phone or personal email', done: !!(p.phone || p.email) },
    { key: 'address', label: 'Home address', done: !!p.homeAddress },
    { key: 'emergency', label: 'Emergency contact', done: !!(p.emergencyName && p.emergencyPhone) },
    { key: 'about', label: 'About me or skills', done: !!p.bio || p.skills.length > 0 },
  ];
}

const clean = (v: string | undefined) => (v === undefined ? undefined : v || null);

export async function saveProfile(tdb: TenantDb, org: Organization, e: Employee & { candidate: { id: string; name: string; email: string | null; phone: string | null; photoFileId: string | null; skills: string[] } }, body: unknown) {
  const r = ProfileBody.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Check your details.');
  const b = r.data;
  if (b.emergencyPhone && !b.emergencyName && !e.emergencyName) throw new HttpError(400, 'Add your emergency contact’s name too.');
  const emp = { preferredName: clean(b.preferredName), pronouns: clean(b.pronouns), homeAddress: clean(b.homeAddress), emergencyName: clean(b.emergencyName), emergencyRelation: clean(b.emergencyRelation), emergencyPhone: clean(b.emergencyPhone), bio: clean(b.bio) };
  const cand = { email: clean(b.email), phone: clean(b.phone), skills: b.skills ? [...new Set(b.skills)] : undefined, certs: b.certs ? [...new Set(b.certs)] : undefined };
  const strip = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
  const ed = strip(emp), cd = strip(cand);
  if (!Object.keys(ed).length && !Object.keys(cd).length) return { message: 'Nothing to change.' };
  if (Object.keys(cd).length) await tdb.candidate.updateMany({ where: { id: e.candidateId }, data: cd });
  const after = { ...e, ...ed, email: cd.email !== undefined ? cd.email : e.candidate.email, phone: cd.phone !== undefined ? cd.phone : e.candidate.phone, photo: !!e.candidate.photoFileId, skills: cd.skills ?? e.candidate.skills } as ProfileState;
  const complete = profileSteps(after).every((s) => s.done);
  await tdb.employee.updateMany({ where: { id: e.id }, data: { ...ed, ...(complete && !e.profileCompletedAt ? { profileCompletedAt: new Date() } : {}) } });
  const what = [...Object.keys(ed), ...Object.keys(cd)].map((k) => ({ preferredName: 'preferred name', homeAddress: 'home address', emergencyName: 'emergency contact', emergencyRelation: 'emergency contact', emergencyPhone: 'emergency contact', bio: 'about me' } as Record<string, string>)[k] ?? k);
  await logActivity(org.id, `${e.candidate.name} updated their profile (${[...new Set(what)].join(', ')})`);
  return { message: complete && !e.profileCompletedAt ? 'Your profile is complete. Thank you!' : 'Saved.' };
}

// ---- photo ----

const MAX_PHOTO = 2 * 1024 * 1024;
/** JPEG or PNG, by its first bytes (never by the name or the type the browser claims). */
export function imageType(b: Buffer): 'image/jpeg' | 'image/png' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

/** Stores a new profile picture and replaces the old one. The page shrinks it (and drops its location data) before upload. */
export async function savePhoto(tdb: TenantDb, orgId: string, candidate: { id: string; name: string; photoFileId: string | null }, body: Buffer) {
  if (!body.length) throw new HttpError(400, 'Choose a picture.');
  if (body.length > MAX_PHOTO) throw new HttpError(413, 'That picture is too large. Choose one under 2 MB.');
  const type = imageType(body);
  if (!type) throw new HttpError(415, 'Use a JPEG or PNG picture.');
  const f = await putFile(orgId, `photo-${candidate.id}.${type === 'image/png' ? 'png' : 'jpg'}`, type, body);
  await tdb.candidate.updateMany({ where: { id: candidate.id }, data: { photoFileId: f.id } });
  if (candidate.photoFileId) await tdb.storedFile.deleteMany({ where: { id: candidate.photoFileId } });
  return { message: 'Picture saved.' }; // the page re-checks whether the profile is now complete
}

export async function removePhoto(tdb: TenantDb, candidate: { id: string; photoFileId: string | null }) {
  if (!candidate.photoFileId) return { message: 'There’s no picture to remove.' };
  await tdb.candidate.updateMany({ where: { id: candidate.id }, data: { photoFileId: null } });
  await tdb.storedFile.deleteMany({ where: { id: candidate.photoFileId } });
  return { message: 'Picture removed.' };
}

// ---- tasks ----

type TaskWithComments = Task & { comments: { id: string; byEmployee: boolean; authorName: string; body: string; createdAt: Date }[] };

/**
 * Tasks assigned to them: open ones, and ones finished in the last 30 days. What changed since they last looked is marked
 * new. Reading doesn't mark anything seen (pages can load twice); the page says when it has shown them, with `markSeen`.
 */
export async function employeeTasks(tdb: TenantDb, employeeId: string, now = new Date()) {
  const rows: TaskWithComments[] = await tdb.task.findMany({
    where: { employeeId, OR: [{ done: false }, { doneAt: { gte: new Date(now.getTime() - 30 * 864e5) } }, { doneAt: null, updatedAt: { gte: new Date(now.getTime() - 30 * 864e5) } }] },
    include: { comments: { orderBy: { createdAt: 'asc' }, take: 50 } }, orderBy: [{ done: 'asc' }, { dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }], take: 60,
  });
  const out = rows.map((t) => {
    const seen = t.employeeSeenAt?.getTime() ?? 0;
    const fromTeam = t.comments.filter((c) => !c.byEmployee && c.createdAt.getTime() > seen).length;
    return {
      id: t.id, title: t.title, details: t.details, dueAt: t.dueAt ? ymd(t.dueAt) : null, priority: t.priority, done: t.done, doneAt: t.doneAt ? ymd(t.doneAt) : null,
      isNew: !t.employeeSeenAt, newUpdates: fromTeam,
      updates: t.comments.map((c) => ({ id: c.id, mine: c.byEmployee, author: c.byEmployee ? 'You' : c.authorName, body: c.body, at: c.createdAt.toISOString() })),
    };
  });
  return out;
}

/** The page showed them their tasks: the next visit only marks what's new after now. */
export async function markTasksSeen(tdb: TenantDb, employeeId: string, now = new Date()) {
  await tdb.task.updateMany({ where: { employeeId, OR: [{ employeeSeenAt: null }, { employeeSeenAt: { lt: now } }] }, data: { employeeSeenAt: now } });
  return { ok: true };
}

export const TaskActionBody = z.object({ taskId: z.string(), done: z.boolean().optional(), update: z.string().trim().max(1000, 'Keep updates under 1,000 characters.').optional() });

/** Mark their task done (or not), and/or post an update on it. */
export async function employeeTaskAction(tdb: TenantDb, org: Organization, e: { id: string; candidate: { name: string } }, body: unknown) {
  const r = TaskActionBody.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Check the form and try again.');
  const b = r.data;
  const t = await tdb.task.findFirst({ where: { id: b.taskId, employeeId: e.id } });
  if (!t) throw new HttpError(404, 'That task isn’t assigned to you any more.');
  if (b.done === undefined && !b.update) throw new HttpError(400, 'Write an update first.');
  if (b.update) await tdb.taskComment.create({ data: { taskId: t.id, byEmployee: true, authorName: e.candidate.name, body: b.update } as never });
  if (b.done !== undefined && b.done !== t.done) {
    await tdb.task.updateMany({ where: { id: t.id }, data: { done: b.done, doneAt: b.done ? new Date() : null, employeeSeenAt: new Date() } });
    await logActivity(org.id, `${e.candidate.name} ${b.done ? 'finished' : 'reopened'} the task “${t.title}”`);
  } else await tdb.task.updateMany({ where: { id: t.id }, data: { employeeSeenAt: new Date() } }); // bumps updatedAt so the team sees the update
  if (b.update) await logActivity(org.id, `${e.candidate.name} posted an update on “${t.title}”`);
  return { message: b.done === true ? 'Marked done. Thanks!' : b.done === false ? 'Reopened.' : 'Update sent.' };
}

/** The team's side: post an update on a task, which reaches the employee it's assigned to. */
export async function staffTaskComment(tdb: TenantDb, org: Organization, user: { id: string; name: string | null; email: string }, taskId: string, body: unknown) {
  const r = z.object({ body: z.string().trim().min(1, 'Write an update first.').max(1000, 'Keep updates under 1,000 characters.') }).safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Write an update first.');
  const t = await tdb.task.findFirst({ where: { id: taskId } });
  if (!t) throw new HttpError(404, 'That task was deleted.');
  await tdb.taskComment.create({ data: { taskId, authorName: user.name ?? user.email, userId: user.id, body: r.data.body } as never });
  await tdb.task.updateMany({ where: { id: taskId }, data: { updatedAt: new Date() } });
  const notified = t.employeeId ? await notifyTask(tdb, org, t.employeeId, t.title, 'update', user.id) : null;
  return { ok: true, notified };
}

/**
 * Tells the employee about a task (newly assigned, or a new update from the team), with a private link to their page.
 * One message (email if we have one, otherwise text), honoring opt-outs, logged to their messages.
 */
export async function notifyTask(tdb: TenantDb, org: Organization, employeeId: string, title: string, kind: 'assigned' | 'update', sentById: string | null) {
  const e = await tdb.employee.findFirst({ where: { id: employeeId, status: { not: 'TERMINATED' } }, include: { candidate: { select: { id: true, name: true, email: true, phone: true, emailOptOut: true, smsOptOut: true } } } });
  if (!e) return 'not an active employee';
  const c = { ...e.candidate, email: e.candidate.email ?? e.workEmail };
  const channel = c.email && !c.emailOptOut ? 'email' : c.phone && !c.smsOptOut ? 'sms' : c.email ? 'email' : 'sms';
  const now = new Date();
  // A new link each time; earlier notices keep working until they expire (an employee may open an older email).
  const token = newToken();
  await tdb.workerLink.create({ data: { candidateId: c.id, tokenHash: sha256(token), kind: 'task', expiresAt: new Date(now.getTime() + 30 * 864e5) } as never });
  const company = org.shortName ?? org.name, link = `${appUrl()}/shifts/${token}#tasks`, first = c.name.split(' ')[0] || 'there';
  const what = kind === 'assigned' ? `You have a new task: “${title}”.` : `There’s an update on your task “${title}”.`;
  const msg = channel === 'sms'
    ? { subject: '', text: `${company}: ${what} See it here: ${link}` }
    : { subject: `${company}: ${kind === 'assigned' ? 'New task' : 'Task update'} — ${title}`.slice(0, 150), text: `Hi ${first},\n\n${what} See the details, post an update or mark it done on your employee page:\n\n${link}\n\nThis link is just for you, so please don’t share it.\n\nThank you,\n${company}` };
  return deliver(tdb, c, channel, msg, { name: company }, sentById);
}

// ---- internal jobs ----

/** Open jobs posted to employees, other than the one they're in, with whether they've already applied. */
export async function internalJobs(tdb: TenantDb, e: { candidateId: string; applicationId: string | null }) {
  const own = e.applicationId ? (await tdb.application.findFirst({ where: { id: e.applicationId }, select: { jobId: true } }))?.jobId : null;
  const [jobs, mine] = await Promise.all([
    tdb.job.findMany({ where: { status: 'OPEN', internal: true, ...(own ? { id: { not: own } } : {}) }, include: { branch: { select: { name: true } } }, orderBy: [{ hot: 'desc' }, { createdAt: 'desc' }], take: 40 }),
    tdb.application.findMany({ where: { candidateId: e.candidateId }, select: { jobId: true, stage: true } }),
  ]);
  const applied = new Map(mine.map((a) => [a.jobId, a.stage]));
  return jobs.map((j) => ({
    id: j.id, title: j.title, location: j.branch?.name ?? j.location, type: j.type, payRate: j.payRate == null ? null : Number(j.payRate),
    description: (j.posting ?? j.description ?? '').slice(0, 4000) || null, skills: j.skills, startDate: j.startDate ? ymd(j.startDate) : null, hot: j.hot,
    applied: applied.has(j.id), status: applied.has(j.id) ? (applied.get(j.id) === 'REJECTED' ? 'closed' : 'in review') : null,
  }));
}

export const ApplyBody = z.object({ jobId: z.string(), note: z.string().trim().max(1000, 'Keep your note under 1,000 characters.').optional() });

/** Applies for an internal job with the profile the company already has. The hiring team gets a task to follow up. */
export async function applyInternal(tdb: TenantDb, org: Organization, e: { id: string; candidateId: string; applicationId: string | null; title: string; candidate: { name: string }; manager?: { candidate: { name: string } } | null }, body: unknown) {
  const r = ApplyBody.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Check the form and try again.');
  const job = await tdb.job.findFirst({ where: { id: r.data.jobId, status: 'OPEN', internal: true } });
  if (!job) throw new HttpError(404, 'That job is no longer open.');
  if (await tdb.application.findFirst({ where: { jobId: job.id, candidateId: e.candidateId } })) throw new HttpError(409, 'You’ve already applied for this job.');
  const app = await tdb.application.create({ data: { candidateId: e.candidateId, jobId: job.id, stage: 'APPLIED', maxStage: 'APPLIED', source: 'internal' } as never });
  await scoreApplications(tdb, [{ id: app.id, jobId: job.id, candidateId: e.candidateId }]).catch(() => undefined);
  const note = r.data.note ? ` Their note: “${r.data.note}”` : '';
  await tdb.task.create({ data: { title: `Internal applicant: ${e.candidate.name} (${e.title}${e.manager ? `, reports to ${e.manager.candidate.name}` : ''}) applied for ${job.title}. Review their application.${note}`.slice(0, 600), related: `application:${app.id}`, priority: 'Normal', dueAt: new Date(Date.now() + 3 * 864e5) } as never });
  await logActivity(org.id, `${e.candidate.name} applied internally for ${job.title}`);
  return { message: `Applied for ${job.title}. The hiring team will be in touch.` };
}

// ---- training sign-up ----

/** Courses open to sign-up that they aren't already taking or certified in. */
export async function trainingCatalog(tdb: TenantDb, candidateId: string) {
  const [courses, mine] = await Promise.all([
    tdb.trainingCourse.findMany({ where: { archived: false, signup: { in: ['open', 'approval'] } }, orderBy: { title: 'asc' } }),
    tdb.trainingEnrollment.findMany({ where: { candidateId, status: { in: ['requested', 'assigned', 'evaluation', 'certified'] } }, select: { courseId: true, status: true, expiresAt: true } }),
  ]);
  const today = ymd(new Date());
  return courses.map((c) => {
    const m = mine.filter((x) => x.courseId === c.id && !(x.status === 'certified' && x.expiresAt && ymd(x.expiresAt) < today));
    const state = m.find((x) => x.status === 'requested') ? 'requested' : m.find((x) => x.status === 'assigned' || x.status === 'evaluation') ? 'taking' : m.find((x) => x.status === 'certified') ? 'certified' : null;
    return { id: c.id, title: c.title, description: c.description, certType: c.certType, lessons: (c.lessons as unknown[]).length, needsApproval: c.signup === 'approval', prerequisite: c.prerequisite, state };
  });
}

export const SignupBody = z.object({ courseId: z.string(), note: z.string().trim().max(500, 'Keep your note under 500 characters.').optional() });

/** Enrols them (open courses) or asks for a place (approval courses). */
export async function trainingSignup(tdb: TenantDb, org: Organization, candidate: { id: string; name: string }, body: unknown) {
  if (!hasFeature(org, 'training')) throw new HttpError(404, 'Training isn’t set up here.');
  const r = SignupBody.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Check the form and try again.');
  const c = await tdb.trainingCourse.findFirst({ where: { id: r.data.courseId, archived: false, signup: { in: ['open', 'approval'] } } });
  if (!c) throw new HttpError(404, 'That course isn’t open for sign-up.');
  if (await tdb.trainingEnrollment.findFirst({ where: { courseId: c.id, candidateId: candidate.id, status: { in: ['requested', 'assigned', 'evaluation'] } } })) throw new HttpError(409, 'You’re already signed up for this course.');
  const open = c.signup === 'open';
  await tdb.trainingEnrollment.create({ data: { courseId: c.id, candidateId: candidate.id, reason: 'initial', status: open ? 'assigned' : 'requested', requestNote: r.data.note || null } as never });
  if (!open) await tdb.task.create({ data: { title: `Training request: ${candidate.name} asked to take ${c.title}. Approve or decline it on the Training page.${r.data.note ? ` Their note: “${r.data.note}”` : ''}`.slice(0, 600), related: `training:${c.id}`, priority: 'Normal', dueAt: new Date(Date.now() + 3 * 864e5) } as never });
  await logActivity(org.id, open ? `${candidate.name} signed up for ${c.title}` : `${candidate.name} asked to take ${c.title}`);
  return { message: open ? `You’re signed up. ${c.title} is now in your training list.` : `Request sent. You’ll see ${c.title} in your training list once it’s approved.` };
}

/** The team approves (it becomes regular training) or declines a sign-up request. */
export async function decideTrainingRequest(tdb: TenantDb, org: Organization, user: { id: string }, enrollmentId: string, approve: boolean) {
  const e = await tdb.trainingEnrollment.findFirst({ where: { id: enrollmentId, status: 'requested' }, include: { course: { select: { title: true } }, candidate: { select: { name: true } } } });
  if (!e) throw new HttpError(409, 'That request was already answered.');
  await tdb.trainingEnrollment.updateMany({ where: { id: e.id, status: 'requested' }, data: approve ? { status: 'assigned', assignedById: user.id } : { status: 'cancelled' } });
  await tdb.task.updateMany({ where: { related: `training:${e.courseId}`, done: false, title: { startsWith: `Training request: ${e.candidate.name} ` } }, data: { done: true, doneAt: new Date() } });
  await logActivity(org.id, `${approve ? 'Approved' : 'Declined'} ${e.candidate.name}’s request to take ${e.course.title}`, user.id);
  return { ok: true };
}
