import { z } from 'zod';
import type { Organization, User } from '@prisma/client';
import { HttpError, logActivity, tenantDb, type TenantDb } from './tenant';
import { localDate } from './timeclock';
import { addDays } from './schedule';
import { rankJobsFor, scoreApplications } from './match-server';
import { deliver } from './schedule-server';

/**
 * Redeployment: workers whose assignment is ending (or just ended) without a next one, with the open jobs they fit
 * best, so a recruiter can line up their next placement before they go to another agency. An assignment's end is its
 * end date when one is set, otherwise the last scheduled shift when nothing is scheduled after it.
 */
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const AHEAD = 14, BEHIND = 30;

export type Ending = {
  applicationId: string; candidateId: string; name: string; phone: string | null; smsOptOut: boolean; job: string; client: string | null;
  endDate: string; inferred: boolean; daysLeft: number; skills: string[];
  matches: { jobId: string; title: string; location: string | null; score: number }[];
};

export async function endingAssignments(tdb: TenantDb, org: Organization, now = new Date(), opts: { matches?: number } = {}) {
  const today = localDate(now, org.timezone);
  const placed = await tdb.application.findMany({
    where: { stage: 'PLACED', redeployedAt: null },
    include: { candidate: { select: { id: true, name: true, phone: true, smsOptOut: true, skills: true, status: true } }, job: { select: { title: true, client: { select: { name: true } } } } },
  });
  if (!placed.length) return [];
  // Shifts around today, to infer an end where no end date is set and to see who already has more work lined up.
  const shifts = await tdb.shift.findMany({ where: { cancelled: false, applicationId: { in: placed.map((a) => a.id) }, date: { gte: new Date(`${addDays(today, -BEHIND)}T00:00:00Z`) } }, select: { applicationId: true, date: true } });
  const lastShift = new Map<string, string>();
  for (const s of shifts) { const d = ymd(s.date); if (!lastShift.has(s.applicationId) || d > lastShift.get(s.applicationId)!) lastShift.set(s.applicationId, d); }
  const ends = placed.map((a) => {
    const set = a.assignmentEnd ? ymd(a.assignmentEnd) : null, last = lastShift.get(a.id) ?? null;
    // Without an end date, a placement whose shifts stop within a week is ending; one with no shifts at all isn't counted.
    const end = set ?? (last && last <= addDays(today, 7) ? last : null);
    return { a, end, inferred: !set };
  }).filter((x): x is typeof x & { end: string } => !!x.end && x.end >= addDays(today, -BEHIND) && x.end <= addDays(today, AHEAD));
  // Someone with another placement that runs past this one isn't waiting for work.
  const byCand = new Map<string, string>();
  for (const a of placed) {
    const end = a.assignmentEnd ? ymd(a.assignmentEnd) : lastShift.get(a.id) && lastShift.get(a.id)! > addDays(today, 7) ? '9999-12-31' : !lastShift.has(a.id) ? '9999-12-31' : lastShift.get(a.id)!;
    if (!byCand.has(a.candidateId) || end > byCand.get(a.candidateId)!) byCand.set(a.candidateId, end);
  }
  const rows = ends.filter((x) => byCand.get(x.a.candidateId)! <= x.end).sort((p, q) => p.end.localeCompare(q.end));
  const out: Ending[] = [];
  for (const { a, end, inferred } of rows) {
    const matches = opts.matches === 0 ? [] : (await rankJobsFor(tdb, a.candidateId, opts.matches ?? 3)).filter((m) => m.score >= 35).map((m) => ({ jobId: m.jobId, title: m.title, location: m.location, score: m.score }));
    out.push({
      applicationId: a.id, candidateId: a.candidateId, name: a.candidate.name, phone: a.candidate.phone, smsOptOut: a.candidate.smsOptOut, job: a.job.title, client: a.job.client?.name ?? null,
      endDate: end, inferred, daysLeft: Math.round((Date.parse(end) - Date.parse(today)) / 864e5), skills: a.candidate.skills.slice(0, 6), matches,
    });
  }
  return out;
}

export const RedeployBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('endDate'), applicationId: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.').nullable() }),
  z.object({ action: z.literal('handled'), applicationId: z.string(), note: z.string().trim().min(2, 'Say what happened (e.g. extended, not available).').max(200) }),
  z.object({ action: z.literal('submit'), applicationId: z.string(), jobId: z.string() }),
  z.object({ action: z.literal('text'), applicationId: z.string(), jobId: z.string() }),
]);

/** Set the end date, mark it handled, put them forward for a job, or text them about one. */
export async function redeployAction(ctx: { tdb: TenantDb; org: Organization; user: User }, body: unknown) {
  const r = RedeployBody.safeParse(body ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Check the form.');
  const { tdb, org, user } = ctx, b = r.data;
  const app = await tdb.application.findFirst({ where: { id: b.applicationId }, include: { candidate: true, job: { select: { title: true } } } });
  if (!app) throw new HttpError(404, 'That placement was deleted.');
  const name = app.candidate.name;
  if (b.action === 'endDate') {
    await tdb.application.updateMany({ where: { id: app.id }, data: { assignmentEnd: b.date ? new Date(`${b.date}T00:00:00Z`) : null, redeployedAt: null, redeployNote: null } });
    await logActivity(org.id, b.date ? `${name}’s assignment (${app.job.title}) ends ${b.date}` : `Cleared ${name}’s assignment end date`, user.id);
    return { message: b.date ? 'End date saved.' : 'End date cleared.' };
  }
  if (b.action === 'handled') {
    await tdb.application.updateMany({ where: { id: app.id }, data: { redeployedAt: new Date(), redeployNote: b.note } });
    await tdb.task.updateMany({ where: { related: `redeploy:${app.id}`, done: false }, data: { done: true, doneAt: new Date() } });
    await logActivity(org.id, `Redeployment for ${name}: ${b.note}`, user.id);
    return { message: 'Marked handled.' };
  }
  const job = await tdb.job.findFirst({ where: { id: b.jobId, status: 'OPEN' } });
  if (!job) throw new HttpError(404, 'That job is no longer open.');
  if (b.action === 'submit') {
    if (await tdb.application.findFirst({ where: { candidateId: app.candidateId, jobId: job.id } })) throw new HttpError(409, `${name} is already in the pipeline for ${job.title}.`);
    const next = await tdb.application.create({ data: { candidateId: app.candidateId, jobId: job.id, stage: 'SUBMITTED', maxStage: 'SUBMITTED', source: 'redeploy' } as never });
    await scoreApplications(tdb, [{ id: next.id, jobId: job.id, candidateId: app.candidateId }]).catch(() => undefined);
    await tdb.task.updateMany({ where: { related: `redeploy:${app.id}`, done: false }, data: { done: true, doneAt: new Date() } });
    await logActivity(org.id, `Put ${name} forward for ${job.title} (redeployment)`, user.id);
    return { message: `${name} is in the pipeline for ${job.title} as Submitted.` };
  }
  // A text about the job, logged and honoring their opt-out.
  const company = org.shortName ?? org.name;
  const p = await deliver(tdb, app.candidate, 'sms', { subject: '', text: `${company}: hi ${name.split(' ')[0]}, your assignment is wrapping up and we have a ${job.title} opening${job.location ? ` in ${job.location}` : ''}${job.payRate ? ` at $${Number(job.payRate).toFixed(2)}/hr` : ''}. Interested? Reply YES and we’ll set it up.` }, { name: company, replyTo: user.email }, user.id);
  if (p) throw new HttpError(409, `Couldn’t text ${name}: ${p}.`);
  await logActivity(org.id, `Texted ${name} about ${job.title} (redeployment)`, user.id);
  return { message: `Texted ${name} about ${job.title}.` };
}

/** Daily: a task a week before each assignment ends, so someone lines up the next one. */
export async function runRedeployTasks(org: Organization, now = new Date()) {
  const tdb = tenantDb(org.id), today = localDate(now, org.timezone);
  let created = 0;
  for (const e of await endingAssignments(tdb, org, now, { matches: 0 })) {
    if (e.daysLeft > 7 || e.daysLeft < -3) continue;
    const related = `redeploy:${e.applicationId}`;
    if (await tdb.task.findFirst({ where: { related } })) continue;
    await tdb.task.create({ data: { title: `Redeploy ${e.name}: ${e.job}${e.client ? ` at ${e.client}` : ''} ${e.daysLeft >= 0 ? `ends ${e.endDate}` : `ended ${e.endDate}`}. Line up their next assignment.`, related, priority: e.daysLeft <= 3 ? 'High' : 'Normal', dueAt: new Date(`${e.daysLeft > 2 ? addDays(e.endDate, -2) : today}T00:00:00Z`) } as never });
    created++;
  }
  return created;
}
