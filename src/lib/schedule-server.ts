import { z } from 'zod';
import type { Organization, User } from '@prisma/client';
import { db } from './db';
import { HttpError, tenantDb, logActivity, type TenantDb } from './tenant';
import { hasFeature } from './plans';
import { sendEmail } from './email';
import { sendSms } from './sms';
import { newToken, sha256 } from './tokens';
import { credentialLabel, credentialStatus } from './credentials';
import { onboardingGaps } from './onboarding-server';
import {
  MIN_REST_HOURS, TIME_RE, WEEK_HOURS_BEFORE_OT, addDays, clock, dayLabel, overlaps, reminderNotice, restHours, scheduleNotice,
  spanMinutes, weekDays, weekHours, type NoticeShift, type ShiftTimes,
} from './schedule';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.').refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Choose a date.');
const TIME = (label: string) => z.string().regex(TIME_RE, `Enter a ${label} time.`);
const opt = (max: number, label: string) => z.union([z.string().max(max, `${label} is too long.`), z.null()]).optional().transform((v) => (v?.trim() ? v.trim() : v === undefined ? undefined : null));

const Fields = {
  start: TIME('start'), end: TIME('end'),
  breakMinutes: z.coerce.number({ invalid_type_error: 'Enter the break in minutes.' }).int('Enter the break in whole minutes.').min(0, 'The break can’t be negative.').max(240, 'Breaks over 4 hours aren’t supported.'),
  unit: opt(80, 'Unit'), notes: opt(500, 'Notes'),
};
export const CreateShift = z.object({ applicationId: z.string().min(1, 'Choose a worker.'), dates: z.array(DATE).min(1, 'Choose at least one day.').max(31, 'Add up to 31 days at a time.'), ...Fields });
export const UpdateShift = z.object({ date: DATE, ...Fields }).partial();

export function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Invalid input');
  return r.data;
}
export function checkTimes(t: { start: string; end: string; breakMinutes: number }) {
  if (t.start === t.end) throw new HttpError(400, 'The shift has to end at a different time than it starts.');
  if (t.breakMinutes >= spanMinutes(t.start, t.end)) throw new HttpError(400, 'The break is longer than the shift.');
}

/** Workers on assignment: placed on a job that isn't direct hire (the same people who get timesheets). */
export const assignmentWhere = { stage: 'PLACED' as const, job: { type: { not: 'DIRECT_HIRE' as const } } };

/** Refuses a shift that overlaps another of the worker's shifts on any assignment. */
export async function assertNoOverlap(tdb: TenantDb, candidateId: string, shifts: ShiftTimes[], excludeId?: string) {
  const dates = shifts.map((s) => s.date).sort();
  const existing = await tdb.shift.findMany({
    where: { cancelled: false, application: { candidateId }, date: { gte: day(addDays(dates[0], -1)), lte: day(addDays(dates[dates.length - 1], 1)) }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    include: { application: { select: { job: { select: { title: true } } } } },
  });
  for (let i = 0; i < shifts.length; i++) {
    for (let j = i + 1; j < shifts.length; j++) if (overlaps(shifts[i], shifts[j])) throw new HttpError(400, 'Two of those shifts overlap.');
    const hit = existing.find((e) => overlaps(shifts[i], { date: ymd(e.date), start: e.start, end: e.end, breakMinutes: e.breakMinutes }));
    if (hit) throw new HttpError(409, `That overlaps their ${dayLabel(ymd(hit.date))} ${clock(hit.start)}–${clock(hit.end)} shift (${hit.application.job.title}).`);
  }
}

/** Things worth a second look but not blocking: overtime, short turnarounds, credentials that won't be valid on the day. */
export async function shiftWarnings(tdb: TenantDb, orgFeatures: { credentials: boolean }, candidateId: string, dates: string[]) {
  const out: string[] = [];
  const weeks = [...new Set(dates.map((d) => { const x = day(d); x.setUTCDate(x.getUTCDate() + ((7 - x.getUTCDay()) % 7)); return ymd(x); }))];
  for (const w of weeks) {
    const days = weekDays(w);
    const shifts = await tdb.shift.findMany({ where: { cancelled: false, application: { candidateId }, date: { gte: day(days[0]), lte: day(days[6]) } }, orderBy: [{ date: 'asc' }, { start: 'asc' }] });
    const h = weekHours(shifts);
    if (h.overtime > 0) out.push(`${+h.total.toFixed(2)} hours scheduled the week ending ${dayLabel(w, { month: 'short', day: 'numeric' })} — ${+h.overtime.toFixed(2)} over ${WEEK_HOURS_BEFORE_OT} are overtime (1.5×).`);
    const t = shifts.map((s) => ({ date: ymd(s.date), start: s.start, end: s.end, breakMinutes: s.breakMinutes }));
    for (let i = 1; i < t.length; i++) {
      const rest = restHours(t[i - 1], t[i]);
      if (rest >= 0 && rest < MIN_REST_HOURS && (dates.includes(t[i].date) || dates.includes(t[i - 1].date))) out.push(`Only ${+rest.toFixed(1)} hours off before the ${dayLabel(t[i].date)} shift.`);
    }
  }
  const gaps = await onboardingGaps(tdb, candidateId);
  if (gaps) out.push(`Onboarding isn’t finished: ${gaps.left} required step${gaps.left === 1 ? '' : 's'} left (${gaps.packages.join(', ')}).`);
  if (orgFeatures.credentials) {
    const last = [...dates].sort().pop()!;
    const creds = await tdb.credential.findMany({ where: { candidateId } });
    for (const c of creds) {
      const exp = c.expiresAt ? ymd(c.expiresAt) : null;
      if (exp && exp < last) out.push(`${credentialLabel(c)} expires ${dayLabel(exp, { month: 'short', day: 'numeric', year: 'numeric' })}, before the last shift.`);
      else {
        const s = credentialStatus({ type: c.type, number: c.number, state: c.state, expiresAt: exp, verifiedAt: c.verifiedAt?.toISOString() ?? null });
        if (s.state === 'unverified' || s.state === 'incomplete') out.push(`${credentialLabel(c)}: ${s.text.toLowerCase()}.`);
      }
    }
  }
  return [...new Set(out)];
}

// ---- notices ----
export type Channel = 'email' | 'sms';
const LINK_DAYS = 45;
const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';

/** A fresh private link for a worker to see and confirm their shifts. */
export async function workerLink(orgId: string, candidateId: string, lastShift: string) {
  const token = newToken();
  const expiresAt = new Date(Math.max(Date.now() + LINK_DAYS * 864e5, Date.parse(`${lastShift}T00:00:00Z`) + 7 * 864e5));
  await tenantDb(orgId).workerLink.create({ data: { candidateId, tokenHash: sha256(token), expiresAt } as never });
  return `${appUrl()}/shifts/${token}`;
}

export type Worker = { id: string; name: string; email: string | null; phone: string | null; emailOptOut: boolean; smsOptOut: boolean };
export async function deliver(tdb: TenantDb, w: Worker, channel: Channel, msg: { subject: string; text: string }, from: { name: string; replyTo?: string }, sentById: string | null) {
  const to = channel === 'email' ? w.email : w.phone;
  const optedOut = channel === 'email' ? w.emailOptOut : w.smsOptOut;
  const log = (status: string, extra: { providerId?: string; error?: string } = {}) => tdb.message.create({
    data: { channel, toAddress: to ?? '(none)', subject: channel === 'email' ? msg.subject : null, body: msg.text, relatedType: 'candidate', relatedId: w.id, status, sentById, ...extra } as never,
  });
  if (!to) { await log('failed', { error: channel === 'email' ? 'No email address' : 'No phone number' }); return channel === 'email' ? 'no email address' : 'no mobile number'; }
  if (optedOut) { await log('blocked_opt_out', { error: 'Opted out' }); return channel === 'email' ? 'opted out of email' : 'opted out of texts'; }
  try {
    const r = channel === 'email' ? await sendEmail({ to, subject: msg.subject, text: msg.text, fromName: from.name, replyTo: from.replyTo }) : await sendSms(to, msg.text);
    await log('sent', { providerId: r.id });
    return null;
  } catch (e) {
    await log('failed', { error: String((e as Error).message).slice(0, 300) });
    return `couldn’t deliver (${String((e as Error).message).slice(0, 80)})`;
  }
}

const noticeInclude = { application: { select: { candidate: true, job: { select: { title: true, location: true, client: { select: { name: true } } } } } } } as const;
type NoticeRow = Awaited<ReturnType<TenantDb['shift']['findMany']>>[number] & { application: { candidate: Worker; job: { title: string; location: string | null; client: { name: string } | null } } };
const toNotice = (s: NoticeRow): NoticeShift => ({
  date: ymd(s.date), start: s.start, end: s.end, breakMinutes: s.breakMinutes, unit: s.unit, notes: s.notes, cancelled: s.cancelled, isNew: !s.notifiedAt,
  job: s.application.job.title, client: s.application.job.client?.name ?? null, location: s.application.job.location,
});

/**
 * Publishes a week: each worker with new, changed or cancelled shifts gets one merged notice per chosen channel.
 * Shifts are marked as notified only when at least one notice reached the worker.
 */
export async function publishWeek(org: Organization, user: User, weekEnding: string, channels: Channel[], applicationIds?: string[]) {
  const tdb = tenantDb(org.id);
  const days = weekDays(weekEnding);
  const pending = await tdb.shift.findMany({
    where: { notified: false, date: { gte: day(days[0]), lte: day(days[6]) }, OR: [{ cancelled: false }, { notifiedAt: { not: null } }], ...(applicationIds ? { applicationId: { in: applicationIds } } : {}) },
    include: noticeInclude, orderBy: [{ date: 'asc' }, { start: 'asc' }],
  }) as NoticeRow[];
  const byWorker = new Map<string, NoticeRow[]>();
  for (const s of pending) byWorker.set(s.application.candidate.id, [...(byWorker.get(s.application.candidate.id) ?? []), s]);
  const company = org.shortName ?? org.name;
  const results: { worker: string; shifts: number; delivered: Channel[]; problems: string[] }[] = [];
  for (const shifts of byWorker.values()) {
    const w = shifts[0].application.candidate;
    const link = await workerLink(org.id, w.id, ymd(shifts[shifts.length - 1].date));
    const delivered: Channel[] = [], problems: string[] = [];
    for (const ch of channels) {
      const msg = scheduleNotice({ firstName: w.name.split(' ')[0] || 'there', company, shifts: shifts.map(toNotice), link, channel: ch });
      const problem = await deliver(tdb, w, ch, msg, { name: company, replyTo: user.email }, user.id);
      if (problem) problems.push(problem); else delivered.push(ch);
    }
    if (delivered.length) {
      const now = new Date();
      await tdb.shift.updateMany({ where: { id: { in: shifts.filter((s) => !s.cancelled).map((s) => s.id) } }, data: { notified: true, notifiedAt: now, response: 'PENDING', respondedAt: null, declineReason: null, remindedAt: null } });
      await tdb.shift.updateMany({ where: { id: { in: shifts.filter((s) => s.cancelled).map((s) => s.id) } }, data: { notified: true, notifiedAt: now } });
    }
    results.push({ worker: w.name, shifts: shifts.length, delivered, problems });
  }
  const told = results.filter((r) => r.delivered.length).length;
  if (results.length) await logActivity(org.id, `Published the schedule for the week ending ${dayLabel(weekEnding, { month: 'short', day: 'numeric' })}: notified ${told} of ${results.length} worker${results.length === 1 ? '' : 's'}`, user.id);
  return results;
}

/**
 * Day-before reminders (run once a day, late afternoon US time): one text — or email when texting isn't possible —
 * per worker with a published, confirmed-or-pending shift tomorrow.
 */
export async function runShiftReminders(now = new Date()) {
  const tomorrow = day(addDays(ymd(now), 1));
  const orgs = await db.organization.findMany({ where: { subscriptionStatus: { in: ['trialing', 'active'] } } });
  let sent = 0;
  for (const org of orgs) {
    if (!hasFeature(org, 'scheduling')) continue;
    const tdb = tenantDb(org.id);
    const due = await tdb.shift.findMany({ where: { date: tomorrow, cancelled: false, notified: true, remindedAt: null, response: { not: 'DECLINED' }, application: assignmentWhere }, include: noticeInclude }) as NoticeRow[];
    const byWorker = new Map<string, NoticeRow[]>();
    for (const s of due) byWorker.set(s.application.candidate.id, [...(byWorker.get(s.application.candidate.id) ?? []), s]);
    for (const shifts of byWorker.values()) {
      const w = shifts[0].application.candidate;
      const ch: Channel = w.phone && !w.smsOptOut ? 'sms' : 'email';
      const link = await workerLink(org.id, w.id, ymd(tomorrow));
      const problem = await deliver(tdb, w, ch, reminderNotice({ firstName: w.name.split(' ')[0] || 'there', company: org.shortName ?? org.name, shifts: shifts.map(toNotice), link, channel: ch }), { name: org.shortName ?? org.name }, null);
      // Mark as reminded either way so a worker without contact details isn't retried every run.
      await tdb.shift.updateMany({ where: { id: { in: shifts.map((s) => s.id) } }, data: { remindedAt: new Date() } });
      if (!problem) sent++;
    }
  }
  return { sent };
}

/** Resolves a worker's private link. */
export async function resolveWorkerLink(token: string) {
  if (!token || token.length > 100) return null;
  const link = await db.workerLink.findUnique({ where: { tokenHash: sha256(token) }, include: { organization: true, candidate: { select: { id: true, name: true } } } });
  if (!link || link.expiresAt < new Date() || link.revokedAt) return null;
  return link;
}
