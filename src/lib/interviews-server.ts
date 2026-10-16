import { z } from 'zod';
import type { Interview, Organization, Role, User } from '@prisma/client';
import { HttpError, logActivity, tenantDb, type TenantDb } from './tenant';
import { db } from './db';
import { newToken, sha256 } from './tokens';
import { sendEmail } from './email';
import { deliver, type Channel } from './schedule-server';
import { zonedToUtc } from './timeclock';
import { STAGE_ORDER } from './eeo';
import { INTERVIEW_KINDS, MAX_SLOTS, RECOMMENDATIONS, competenciesFor, icsInvite, overlap, slotProblem, summarize } from './interviews';

/**
 * Interviews: the recruiter offers times (or sets one), the candidate picks from their private page, everyone gets a
 * calendar invite, and each interviewer fills in a scorecard. Interviewers see the others' scorecards only once
 * they've submitted their own, so first impressions don't anchor each other.
 */
const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';
type Ctx = { tdb: TenantDb; org: Organization; user: User; role: Role };
const isAdmin = (r: Role) => r === 'OWNER' || r === 'ADMIN';
const slotsOf = (iv: { slots: unknown }) => (Array.isArray(iv.slots) ? (iv.slots as string[]).map((s) => new Date(s)) : []);
export const when = (d: Date, tz: string) => d.toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const LOCAL = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

const Base = {
  kind: z.enum(Object.keys(INTERVIEW_KINDS) as [keyof typeof INTERVIEW_KINDS]),
  durationMin: z.coerce.number().int().min(15, 'Interviews are at least 15 minutes.').max(240, 'Keep interviews under four hours.'),
  location: z.string().trim().max(300).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  interviewerIds: z.array(z.string()).min(1, 'Choose at least one interviewer.').max(6, 'Up to six interviewers.'),
  slots: z.array(z.string().regex(LOCAL, 'Pick a date and time for each slot.')).min(1, 'Offer at least one time.').max(MAX_SLOTS, `Offer up to ${MAX_SLOTS} times.`),
  channels: z.array(z.enum(['email', 'sms'])).max(2).default([]),
};
export const ProposeBody = z.object({ applicationId: z.string(), title: z.string().trim().max(120).optional(), ...Base });

async function teamNames(orgId: string, ids: string[]) {
  const ms = await db.membership.findMany({ where: { organizationId: orgId, userId: { in: ids } }, include: { user: { select: { id: true, name: true, email: true } } } });
  return ms.map((m) => ({ id: m.user.id, name: m.user.name || m.user.email, email: m.user.email }));
}

/** Times that clash with an interviewer's other scheduled interviews, named for the error. */
async function clashes(tdb: TenantDb, interviewerIds: string[], slots: Date[], durationMin: number, exceptId?: string) {
  const from = new Date(Math.min(...slots.map((s) => s.getTime())) - 6 * 3600e3), to = new Date(Math.max(...slots.map((s) => s.getTime())) + 6 * 3600e3);
  const busy = await tdb.interview.findMany({ where: { status: 'SCHEDULED', startsAt: { gte: from, lte: to }, interviewerIds: { hasSome: interviewerIds }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  return slots.filter((s) => busy.some((b) => overlap(s, durationMin, b.startsAt!, b.durationMin)));
}

function parseSlots(org: Organization, slots: string[], durationMin: number) {
  const dates = slots.map((s) => zonedToUtc(s.slice(0, 10), s.slice(11, 16), org.timezone));
  const p = slotProblem(dates, durationMin);
  if (p) throw new HttpError(400, p);
  return dates.sort((a, b) => a.getTime() - b.getTime());
}

/** Offer times (or set one). Moves the application to Interview if it was earlier in the pipeline. */
export async function proposeInterview(ctx: Ctx, body: unknown) {
  const r = ProposeBody.safeParse(body ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Check the interview details.');
  const b = r.data, { tdb, org, user } = ctx;
  const app = await tdb.application.findFirst({ where: { id: b.applicationId }, include: { candidate: true, job: true } });
  if (!app) throw new HttpError(404, 'That application was deleted.');
  if (app.stage === 'REJECTED') throw new HttpError(409, `${app.candidate.name} was rejected for this job.`);
  const team = await teamNames(org.id, b.interviewerIds);
  if (team.length !== new Set(b.interviewerIds).size) throw new HttpError(400, 'Interviewers must be on your team.');
  const slots = parseSlots(org, b.slots, b.durationMin);
  const busy = await clashes(tdb, b.interviewerIds, slots, b.durationMin);
  if (busy.length) throw new HttpError(409, `An interviewer already has an interview at ${busy.map((s) => when(s, org.timezone)).join(' and ')}. Choose another time.`);
  if (b.kind === 'ONSITE' && !b.location) throw new HttpError(400, 'Add the address for an in-person interview.');
  const one = slots.length === 1;
  const iv = await tdb.interview.create({ data: {
    applicationId: app.id, candidateId: app.candidateId, jobId: app.jobId, title: b.title || `${INTERVIEW_KINDS[b.kind]} interview — ${app.job.title}`,
    kind: b.kind, durationMin: b.durationMin, location: b.location || null, notes: b.notes || null, interviewerIds: [...new Set(b.interviewerIds)],
    slots: slots.map((s) => s.toISOString()), status: one ? 'SCHEDULED' : 'PROPOSED', startsAt: one ? slots[0] : null, createdById: user.id,
  } as never });
  if (STAGE_ORDER.indexOf(app.stage) < STAGE_ORDER.indexOf('INTERVIEW')) {
    await tdb.application.updateMany({ where: { id: app.id }, data: { stage: 'INTERVIEW', maxStage: STAGE_ORDER.indexOf(app.maxStage) < STAGE_ORDER.indexOf('INTERVIEW') ? 'INTERVIEW' : app.maxStage, stageChangedAt: new Date() } });
  }
  await logActivity(org.id, one ? `Scheduled ${app.candidate.name}’s interview for ${app.job.title} on ${when(slots[0], org.timezone)}` : `Offered ${app.candidate.name} ${slots.length} interview times for ${app.job.title}`, user.id);
  const sent = one ? await sendInvites(tdb, org, iv, user) : await sendTimes(tdb, org, iv, app.candidate, b.channels, user);
  return { id: iv.id, status: iv.status, ...sent };
}

/** The candidate's link to pick a time (it expires a day after the last one offered). */
async function sendTimes(tdb: TenantDb, org: Organization, iv: Interview, c: { id: string; name: string; email: string | null; phone: string | null; emailOptOut: boolean; smsOptOut: boolean }, channels: Channel[], user: { id: string; email: string }) {
  if (!channels.length) return { sent: [] as Channel[], problems: [] as string[] };
  const last = Math.max(...slotsOf(iv).map((s) => s.getTime()));
  const token = newToken();
  await tdb.workerLink.create({ data: { candidateId: c.id, tokenHash: sha256(token), kind: 'interview', expiresAt: new Date(last + 864e5) } as never });
  const link = `${appUrl()}/shifts/${token}#interviews`, company = org.shortName ?? org.name, first = c.name.split(' ')[0] || 'there';
  const times = slotsOf(iv).map((s) => `- ${when(s, org.timezone)}`).join('\n');
  const msg = (ch: Channel) => ch === 'sms'
    ? { subject: '', text: `${company}: please pick a time for your ${iv.title.toLowerCase()}: ${link}` }
    : { subject: `${company}: pick a time for your interview`, text: `Hi ${first},\n\nThanks for your interest. Please pick a time for your ${iv.title.toLowerCase()} (${iv.durationMin} minutes):\n\n${times}\n\nChoose one here:\n\n${link}\n\nIf none of these work, say so on that page and we’ll offer others.\n\nThank you,\n${company}` };
  const sent: Channel[] = [], problems: string[] = [];
  for (const ch of channels) { const p = await deliver(tdb, c, ch, msg(ch), { name: company, replyTo: user.email }, user.id); if (p) problems.push(`${ch === 'sms' ? 'Text' : 'Email'}: ${p}`); else sent.push(ch); }
  return { sent, problems };
}

/**
 * Calendar invites to the candidate and the interviewers (or cancellations). The candidate's email is logged with
 * their messages and respects their email opt-out; if they've opted out of email they get a text without the invite.
 */
export async function sendInvites(tdb: TenantDb, org: Organization, iv: Interview, user: { id: string; email: string } | null, opts: { cancel?: boolean; reason?: string } = {}) {
  const app = await tdb.application.findFirst({ where: { id: iv.applicationId }, include: { candidate: true, job: { select: { title: true } } } });
  if (!app || !iv.startsAt) return { sent: [] as Channel[], problems: [] as string[] };
  const c = app.candidate, team = await teamNames(org.id, iv.interviewerIds), company = org.shortName ?? org.name;
  const at = when(iv.startsAt, org.timezone), where = iv.kind === 'PHONE' ? (iv.location ? `We’ll call you at ${iv.location}.` : 'We’ll call you at the number we have on file.') : iv.location ? `${iv.kind === 'VIDEO' ? 'Join' : 'Where'}: ${iv.location}` : '';
  const organizer = { name: company, email: (process.env.EMAIL_FROM ?? 'no-reply@preciops.com').replace(/.*</, '').replace('>', '') };
  const ics = (attendees: { name: string; email: string }[]) => Buffer.from(icsInvite({ uid: `${iv.id}@preciops`, start: iv.startsAt!, durationMin: iv.durationMin, summary: `${iv.title}${opts.cancel ? ' (cancelled)' : ''} — ${c.name}`, description: `${iv.title} with ${c.name} for ${app.job.title}.${where ? `\n${where}` : ''}`, location: iv.location, organizer, attendees, sequence: iv.sequence, cancel: opts.cancel }));
  const sent: Channel[] = [], problems: string[] = [];
  // The candidate
  const subject = opts.cancel ? `${company}: your interview on ${at} is cancelled` : `${company}: interview confirmed for ${at}`;
  const text = opts.cancel ? `Hi ${c.name.split(' ')[0]},\n\nYour ${iv.title.toLowerCase()} on ${at} is cancelled${opts.reason ? `: ${opts.reason}` : '.'}\n\nWe’ll be in touch about next steps.\n\n${company}`
    : `Hi ${c.name.split(' ')[0]},\n\nYou’re confirmed for your ${iv.title.toLowerCase()} on ${at} (${iv.durationMin} minutes).\n${where ? `\n${where}\n` : ''}${iv.notes ? `\n${iv.notes}\n` : ''}\nThe invite is attached so you can add it to your calendar.\n\nSee you then,\n${company}`;
  if (c.email && !c.emailOptOut) {
    let status = 'sent', error: string | null = null, providerId: string | null = null;
    try { providerId = (await sendEmail({ to: c.email, subject, text, fromName: company, replyTo: user?.email, attachments: [{ filename: 'interview.ics', content: ics([{ name: c.name, email: c.email }]) }] })).id; sent.push('email'); }
    catch (e) { status = 'failed'; error = (e as Error).message.slice(0, 300); problems.push(`Email: couldn’t deliver (${error.slice(0, 80)})`); }
    await tdb.message.create({ data: { channel: 'email', toAddress: c.email, subject, body: text, relatedType: 'candidate', relatedId: c.id, status, providerId, error, sentById: user?.id ?? null } as never });
  } else if (c.phone) {
    const p = await deliver(tdb, c, 'sms', { subject: '', text: opts.cancel ? `${company}: your interview on ${at} is cancelled. We’ll be in touch.` : `${company}: you’re confirmed for your interview on ${at}. ${where}`.trim() }, { name: company, replyTo: user?.email }, user?.id ?? null);
    if (p) problems.push(`Text: ${p}`); else sent.push('sms');
  } else problems.push('The candidate has no email or phone number to send the confirmation to.');
  // The interviewers (internal, one email each)
  for (const t of team) {
    await sendEmail({ to: t.email, subject: opts.cancel ? `Cancelled: ${c.name}, ${at}` : `Interview: ${c.name} for ${app.job.title}, ${at}`, text: `${opts.cancel ? 'Cancelled' : 'Scheduled'}: ${iv.title} with ${c.name} on ${at} (${iv.durationMin} minutes).${where ? `\n${where}` : ''}\n\nOpen it in Preciops to see their profile${opts.cancel ? '' : ' and fill in your scorecard afterwards'}: ${appUrl()}/app/interviews?open=${iv.id}`, fromName: company, attachments: [{ filename: 'interview.ics', content: ics(team.map((x) => ({ name: x.name, email: x.email }))) }] })
      .catch((e) => problems.push(`Couldn’t email ${t.name}: ${String((e as Error).message).slice(0, 80)}`));
  }
  return { sent, problems };
}

// ---- the candidate's side ----
type Link = { organizationId: string; candidateId: string; organization: Organization; candidate: { name: string } };

/** Interviews to pick a time for, and the ones coming up. */
export async function workerInterviews(link: Link) {
  const now = new Date(), tz = link.organization.timezone;
  const rows = await tenantDb(link.organizationId).interview.findMany({ where: { candidateId: link.candidateId, OR: [{ status: 'PROPOSED' }, { status: 'SCHEDULED', startsAt: { gte: new Date(now.getTime() - 3600e3) } }] }, orderBy: { createdAt: 'asc' } });
  return rows.map((iv) => {
    const slots = slotsOf(iv).filter((s) => s.getTime() > now.getTime() + 30 * 60e3);
    return {
      id: iv.id, title: iv.title, kind: iv.kind, durationMin: iv.durationMin, status: iv.status, notes: iv.notes, askedForOthers: !!iv.candidateNote,
      // Where it is shows only once it's booked.
      location: iv.status === 'SCHEDULED' ? iv.location : null,
      startsAt: iv.startsAt?.toISOString() ?? null, startsLabel: iv.startsAt ? when(iv.startsAt, tz) : null,
      slots: iv.status === 'PROPOSED' ? slots.map((s) => ({ at: s.toISOString(), label: when(s, tz) })) : [],
    };
  }).filter((x) => x.status === 'SCHEDULED' || x.slots.length || x.askedForOthers);
}

export const PickBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pick'), interviewId: z.string(), at: z.string() }),
  z.object({ action: z.literal('none'), interviewId: z.string(), note: z.string().trim().max(300, 'Keep it under 300 characters.').optional() }),
]);

/** The candidate picks a time, or says none of them work. */
export async function candidateRespond(link: Link, body: unknown) {
  const r = PickBody.safeParse(body ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Choose a time.');
  const tdb = tenantDb(link.organizationId), org = link.organization;
  const iv = await tdb.interview.findFirst({ where: { id: r.data.interviewId, candidateId: link.candidateId } });
  if (!iv) throw new HttpError(404, 'That interview isn’t on your list.');
  if (iv.status !== 'PROPOSED') throw new HttpError(409, iv.status === 'SCHEDULED' ? 'You’ve already picked a time. To change it, reply to your confirmation email.' : 'This interview was cancelled.');
  if (r.data.action === 'none') {
    await tdb.interview.updateMany({ where: { id: iv.id }, data: { candidateNote: r.data.note || 'None of the offered times work.' } });
    await tdb.task.create({ data: { title: `${link.candidate.name} needs other interview times (${iv.title})${r.data.note ? `: “${r.data.note}”` : ''}`.slice(0, 500), related: `interview:${iv.id}`, assigneeId: iv.createdById, priority: 'High', dueAt: new Date(Date.now() + 864e5) } as never });
    await logActivity(org.id, `${link.candidate.name} asked for other interview times`);
    return { message: 'Thanks. We’ll send you other times soon.' };
  }
  const at = new Date(r.data.at);
  const offered = slotsOf(iv).find((s) => s.getTime() === at.getTime());
  if (!offered) throw new HttpError(400, 'That time isn’t one of the options.');
  if (offered.getTime() < Date.now() + 30 * 60e3) throw new HttpError(409, 'That time has passed. Pick another.');
  if ((await clashes(tdb, iv.interviewerIds, [offered], iv.durationMin, iv.id)).length) throw new HttpError(409, 'Someone just took that time. Please pick another.');
  const n = await tdb.interview.updateMany({ where: { id: iv.id, status: 'PROPOSED' }, data: { status: 'SCHEDULED', startsAt: offered, candidateNote: null, sequence: { increment: 1 } } });
  if (!n.count) throw new HttpError(409, 'You’ve already picked a time.');
  const fresh = (await tdb.interview.findFirst({ where: { id: iv.id } }))!;
  await sendInvites(tdb, org, fresh, null);
  await tdb.task.updateMany({ where: { related: `interview:${iv.id}`, done: false }, data: { done: true, doneAt: new Date() } });
  await logActivity(org.id, `${link.candidate.name} picked ${when(offered, org.timezone)} for their interview`);
  return { message: `You’re booked for ${when(offered, org.timezone)}. A calendar invite is on its way.` };
}

/** A calendar file for a booked interview, for the "Add to calendar" button. */
export async function candidateIcs(link: Link, id: string) {
  const iv = await tenantDb(link.organizationId).interview.findFirst({ where: { id, candidateId: link.candidateId, status: 'SCHEDULED' } });
  if (!iv || !iv.startsAt) throw new HttpError(404, 'That interview isn’t booked.');
  const org = link.organization, company = org.shortName ?? org.name;
  return icsInvite({ uid: `${iv.id}@preciops`, start: iv.startsAt, durationMin: iv.durationMin, summary: `${iv.title} — ${company}`, description: iv.notes ?? iv.title, location: iv.location, organizer: { name: company, email: org.applyEmail ?? 'no-reply@preciops.com' }, attendees: [], sequence: iv.sequence });
}

// ---- the team's side ----

export const ChangeBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel'), reason: z.string().trim().max(300).optional(), notify: z.boolean().default(true) }),
  z.object({ action: z.literal('reschedule'), slots: Base.slots, channels: Base.channels }),
  z.object({ action: z.literal('outcome'), status: z.enum(['COMPLETED', 'NO_SHOW']) }),
]);

export async function changeInterview(ctx: Ctx, id: string, body: unknown) {
  const r = ChangeBody.safeParse(body ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Check the form.');
  const { tdb, org, user } = ctx;
  const iv = await tdb.interview.findFirst({ where: { id }, include: { application: { include: { candidate: true } } } });
  if (!iv) throw new HttpError(404, 'That interview was deleted.');
  const name = iv.application.candidate.name;
  if (r.data.action === 'cancel') {
    if (!['PROPOSED', 'SCHEDULED'].includes(iv.status)) throw new HttpError(409, 'This interview is already over.');
    await tdb.interview.updateMany({ where: { id }, data: { status: 'CANCELLED', cancelReason: r.data.reason || null, sequence: { increment: 1 } } });
    await tdb.task.updateMany({ where: { related: `interview:${id}`, done: false }, data: { done: true, doneAt: new Date() } });
    await logActivity(org.id, `Cancelled ${name}’s interview${r.data.reason ? `: ${r.data.reason}` : ''}`, user.id);
    if (iv.status === 'SCHEDULED' && r.data.notify) return { ok: true, ...(await sendInvites(tdb, org, { ...iv, sequence: iv.sequence + 1 }, user, { cancel: true, reason: r.data.reason })) };
    return { ok: true, sent: [], problems: [] };
  }
  if (r.data.action === 'outcome') {
    if (iv.status !== 'SCHEDULED' && iv.status !== 'COMPLETED' && iv.status !== 'NO_SHOW') throw new HttpError(409, 'Only a booked interview can be marked done or a no-show.');
    if (!iv.startsAt || iv.startsAt > new Date()) throw new HttpError(409, 'This interview hasn’t happened yet.');
    await tdb.interview.updateMany({ where: { id }, data: { status: r.data.status } });
    await logActivity(org.id, `${name}’s interview: ${r.data.status === 'NO_SHOW' ? 'no-show' : 'done'}`, user.id);
    return { ok: true, sent: [], problems: [] };
  }
  // Reschedule: new times; a booked one is cancelled on everyone's calendar first.
  if (!['PROPOSED', 'SCHEDULED'].includes(iv.status)) throw new HttpError(409, 'This interview is already over. Schedule a new one.');
  const slots = parseSlots(org, r.data.slots, iv.durationMin);
  const busy = await clashes(tdb, iv.interviewerIds, slots, iv.durationMin, id);
  if (busy.length) throw new HttpError(409, `An interviewer already has an interview at ${busy.map((s) => when(s, org.timezone)).join(' and ')}. Choose another time.`);
  if (iv.status === 'SCHEDULED') await sendInvites(tdb, org, { ...iv, sequence: iv.sequence + 1 }, user, { cancel: true, reason: 'We’re moving it to a new time.' });
  const one = slots.length === 1;
  await tdb.interview.updateMany({ where: { id }, data: { slots: slots.map((s) => s.toISOString()), status: one ? 'SCHEDULED' : 'PROPOSED', startsAt: one ? slots[0] : null, candidateNote: null, remindedAt: null, sequence: { increment: 2 } } });
  await tdb.task.updateMany({ where: { related: `interview:${id}`, done: false }, data: { done: true, doneAt: new Date() } });
  const fresh = (await tdb.interview.findFirst({ where: { id } }))!;
  await logActivity(org.id, one ? `Moved ${name}’s interview to ${when(slots[0], org.timezone)}` : `Offered ${name} new interview times`, user.id);
  return { ok: true, ...(one ? await sendInvites(tdb, org, fresh, user) : await sendTimes(tdb, org, fresh, iv.application.candidate, r.data.channels, user)) };
}

export const ScorecardBody = z.object({
  ratings: z.record(z.string().max(80), z.number().int().min(1).max(4)).refine((r) => Object.keys(r).length <= 12, 'Too many ratings.'),
  recommendation: z.enum(Object.keys(RECOMMENDATIONS) as [keyof typeof RECOMMENDATIONS], { errorMap: () => ({ message: 'Choose your overall recommendation.' }) }),
  notes: z.string().trim().max(4000).optional().nullable(),
});

/** An interviewer's scorecard (they can revise it). The first one after the interview marks it done. */
export async function saveScorecard(ctx: Ctx, id: string, body: unknown) {
  const r = ScorecardBody.safeParse(body ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Check your scorecard.');
  const { tdb, org, user, role } = ctx;
  const iv = await tdb.interview.findFirst({ where: { id }, include: { application: { include: { candidate: { select: { name: true } }, job: { select: { skills: true } } } } } });
  if (!iv) throw new HttpError(404, 'That interview was deleted.');
  if (!iv.interviewerIds.includes(user.id) && !isAdmin(role)) throw new HttpError(403, 'Only the interviewers (or an admin) can fill in a scorecard.');
  if (!iv.startsAt || iv.startsAt > new Date() || !['SCHEDULED', 'COMPLETED'].includes(iv.status)) throw new HttpError(409, 'Fill in the scorecard after the interview.');
  const allowed = competenciesFor(iv.application.job.skills);
  if (Object.keys(r.data.ratings).some((k) => !allowed.includes(k))) throw new HttpError(400, 'Rate only the listed areas.');
  const data = { ratings: r.data.ratings, recommendation: r.data.recommendation, notes: r.data.notes || null };
  const mine = await tdb.scorecard.findFirst({ where: { interviewId: id, userId: user.id } });
  if (mine) await tdb.scorecard.updateMany({ where: { id: mine.id }, data });
  else await tdb.scorecard.create({ data: { interviewId: id, userId: user.id, ...data } as never });
  if (iv.status === 'SCHEDULED') await tdb.interview.updateMany({ where: { id }, data: { status: 'COMPLETED' } });
  await tdb.task.updateMany({ where: { related: `scorecard:${id}:${user.id}`, done: false }, data: { done: true, doneAt: new Date() } });
  if (!mine) await logActivity(org.id, `${user.name ?? user.email} submitted a scorecard for ${iv.application.candidate.name}: ${RECOMMENDATIONS[r.data.recommendation].toLowerCase()}`, user.id);
  return { ok: true };
}

/** One interview with what this person may see of the scorecards. */
export async function interviewDetail(ctx: Ctx, id: string) {
  const { tdb, org, user, role } = ctx;
  const iv = await tdb.interview.findFirst({ where: { id }, include: { scorecards: true, application: { include: { candidate: { select: { id: true, name: true, title: true } }, job: { select: { title: true, skills: true } } } } } });
  if (!iv) throw new HttpError(404, 'That interview was deleted.');
  const team = await teamNames(org.id, [...new Set([...iv.interviewerIds, ...iv.scorecards.map((s) => s.userId)])]);
  const nameOf = (uid: string) => team.find((t) => t.id === uid)?.name ?? 'Former teammate';
  const mine = iv.scorecards.find((s) => s.userId === user.id);
  // Interviewers see the others only after submitting their own.
  const seeAll = isAdmin(role) || !iv.interviewerIds.includes(user.id) || !!mine;
  const visible = seeAll ? iv.scorecards : iv.scorecards.filter((s) => s.userId === user.id);
  return {
    id: iv.id, title: iv.title, kind: iv.kind, durationMin: iv.durationMin, location: iv.location, notes: iv.notes, status: iv.status, candidateNote: iv.candidateNote, cancelReason: iv.cancelReason,
    startsAt: iv.startsAt?.toISOString() ?? null, startsLabel: iv.startsAt ? when(iv.startsAt, org.timezone) : null,
    slots: slotsOf(iv).map((s) => ({ at: s.toISOString(), label: when(s, org.timezone) })),
    candidate: iv.application.candidate, job: iv.application.job.title, applicationId: iv.applicationId,
    interviewers: iv.interviewerIds.map((uid) => ({ id: uid, name: nameOf(uid), submitted: iv.scorecards.some((s) => s.userId === uid) })),
    competencies: competenciesFor(iv.application.job.skills), iAmInterviewer: iv.interviewerIds.includes(user.id), canScore: iv.interviewerIds.includes(user.id) || isAdmin(role),
    mine: mine ? { ratings: mine.ratings as Record<string, number>, recommendation: mine.recommendation, notes: mine.notes } : null,
    hidden: iv.scorecards.length - visible.length,
    scorecards: visible.map((s) => ({ by: nameOf(s.userId), mine: s.userId === user.id, ratings: s.ratings as Record<string, number>, recommendation: s.recommendation, notes: s.notes, at: s.updatedAt.toISOString() })),
    summary: seeAll ? (() => { // in scorecard order (stored ratings don't keep it)
      const sum = summarize(visible.map((s) => ({ ratings: s.ratings as Record<string, number>, recommendation: s.recommendation }))), order = competenciesFor(iv.application.job.skills);
      return { ...sum, competencies: [...sum.competencies].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name)) };
    })() : null,
  };
}

export type InterviewView = 'upcoming' | 'feedback' | 'waiting' | 'past';
/** The Interviews page: what's coming up, what needs your scorecard, what's waiting on candidates, and recent ones. */
export async function listInterviews(ctx: Ctx, view: InterviewView, mineOnly: boolean, opts: { candidateId?: string } = {}) {
  const { tdb, org, user } = ctx, now = new Date();
  const mine = mineOnly ? { interviewerIds: { has: user.id } } : {};
  const where = opts.candidateId ? { candidateId: opts.candidateId }
    : view === 'upcoming' ? { status: 'SCHEDULED', startsAt: { gte: new Date(now.getTime() - 3600e3) }, ...mine }
      : view === 'feedback' ? { status: { in: ['SCHEDULED', 'COMPLETED'] }, startsAt: { lt: now, gte: new Date(now.getTime() - 30 * 864e5) }, interviewerIds: { has: user.id }, NOT: { scorecards: { some: { userId: user.id } } } }
        : view === 'waiting' ? { status: 'PROPOSED', ...mine }
          : { status: { in: ['COMPLETED', 'NO_SHOW', 'CANCELLED'] }, updatedAt: { gte: new Date(now.getTime() - 60 * 864e5) }, ...mine };
  const rows = await tdb.interview.findMany({ where, include: { scorecards: { select: { userId: true, ratings: true, recommendation: true } }, application: { select: { candidate: { select: { name: true } }, job: { select: { title: true } } } } }, orderBy: view === 'past' || opts.candidateId ? { updatedAt: 'desc' } : [{ startsAt: 'asc' }, { createdAt: 'asc' }], take: 200 });
  const team = await teamNames(org.id, [...new Set(rows.flatMap((r) => r.interviewerIds))]);
  return rows.map((iv) => ({
    id: iv.id, title: iv.title, kind: iv.kind, status: iv.status, candidate: iv.application.candidate.name, candidateId: iv.candidateId, job: iv.application.job.title,
    startsAt: iv.startsAt?.toISOString() ?? null, startsLabel: iv.startsAt ? when(iv.startsAt, org.timezone) : null, slotCount: slotsOf(iv).length, candidateNote: iv.candidateNote,
    interviewers: iv.interviewerIds.map((uid) => team.find((t) => t.id === uid)?.name ?? 'Former teammate'),
    scorecards: `${iv.scorecards.length} of ${iv.interviewerIds.length}`, verdict: iv.scorecards.length ? summarize(iv.scorecards.map((s) => ({ ratings: s.ratings as Record<string, number>, recommendation: s.recommendation }))).verdict : null,
  }));
}

/**
 * Daily: a reminder to each candidate the day before their interview (by email, else text; opt-outs honored), and a
 * task for each interviewer who hasn't filled in their scorecard a few hours after the interview.
 */
export async function runInterviewReminders(org: Organization, now = new Date()) {
  const tdb = tenantDb(org.id), company = org.shortName ?? org.name;
  const soon = await tdb.interview.findMany({ where: { status: 'SCHEDULED', remindedAt: null, startsAt: { gte: new Date(now.getTime() + 12 * 3600e3), lte: new Date(now.getTime() + 36 * 3600e3) } }, include: { application: { include: { candidate: true } } } });
  let reminded = 0;
  for (const iv of soon) {
    const c = iv.application.candidate, at = when(iv.startsAt!, org.timezone);
    const ch: Channel = c.email && !c.emailOptOut ? 'email' : 'sms';
    const where = iv.location ? (iv.kind === 'VIDEO' ? ` Join: ${iv.location}` : iv.kind === 'ONSITE' ? ` Where: ${iv.location}` : '') : '';
    const p = await deliver(tdb, c, ch, ch === 'sms' ? { subject: '', text: `${company}: reminder, your interview is ${at}.${where}` } : { subject: `Reminder: your interview ${at}`, text: `Hi ${c.name.split(' ')[0]},\n\nA reminder that your ${iv.title.toLowerCase()} is ${at} (${iv.durationMin} minutes).${where ? `\n${where.trim()}` : ''}\n\nIf you can’t make it, please reply to let us know.\n\n${company}` }, { name: company }, null);
    await tdb.interview.updateMany({ where: { id: iv.id }, data: { remindedAt: now } });
    if (!p) reminded++;
  }
  const done = await tdb.interview.findMany({ where: { status: { in: ['SCHEDULED', 'COMPLETED'] }, startsAt: { lte: new Date(now.getTime() - 3 * 3600e3), gte: new Date(now.getTime() - 14 * 864e5) } }, include: { scorecards: { select: { userId: true } }, application: { select: { candidate: { select: { name: true } } } } } });
  let nudged = 0;
  for (const iv of done) for (const uid of iv.interviewerIds) {
    if (iv.scorecards.some((s) => s.userId === uid)) continue;
    const related = `scorecard:${iv.id}:${uid}`;
    if (await tdb.task.findFirst({ where: { related } })) continue;
    await tdb.task.create({ data: { title: `Fill in your scorecard for ${iv.application.candidate.name} (${iv.title})`, related, assigneeId: uid, priority: 'High', dueAt: now } as never });
    nudged++;
  }
  return { reminded, nudged };
}
