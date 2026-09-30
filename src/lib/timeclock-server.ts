import { z } from 'zod';
import { checkFence, fenceOf, howFar, type FenceResult } from './geo';
import { Prisma, type Organization, type User } from '@prisma/client';
import { HttpError, tenantDb, logActivity, type TenantDb } from './tenant';
import { newToken, sha256 } from './tokens';
import { assignmentWhere, deliver, type Channel } from './schedule-server';
import { hasFeature } from './plans';
import { onboardingGaps } from './onboarding-server';
import { MAX_OPEN_HOURS, localDate, localTime, splitWeek, workedMinutes, zonedToUtc, type Entry } from './timeclock';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';

/** UTC range of a local Mon–Sun workweek ending `weekEnding`. */
export function weekRange(weekEnding: string, tz: string) {
  return { from: zonedToUtc(addDays(weekEnding, -6), '00:00', tz), to: zonedToUtc(addDays(weekEnding, 1), '00:00', tz) };
}

/** The worker's current assignments (what they can clock in to). */
export const assignmentsFor = (tdb: TenantDb, candidateId: string) => tdb.application.findMany({
  where: { candidateId, ...assignmentWhere }, include: { job: { select: { title: true, client: { select: { name: true } } } } }, orderBy: { createdAt: 'asc' },
});

/** The published shift a clock-in most likely belongs to: same assignment, starting within 4 hours of now. */
async function matchShift(tdb: TenantDb, applicationId: string, at: Date, tz: string) {
  const today = localDate(at, tz);
  const shifts = await tdb.shift.findMany({ where: { applicationId, cancelled: false, notifiedAt: { not: null }, date: { in: [new Date(`${addDays(today, -1)}T00:00:00Z`), new Date(`${today}T00:00:00Z`)] } } });
  const scored = shifts.map((s) => ({ s, gap: Math.abs(zonedToUtc(ymd(s.date), s.start, tz).getTime() - at.getTime()) })).filter((x) => x.gap <= 4 * 3600e3);
  return scored.sort((a, b) => a.gap - b.gap)[0]?.s ?? null;
}

const Geo = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000).optional() }).optional();
export const PunchBody = z.object({ action: z.enum(['in', 'break-start', 'break-end', 'out']), applicationId: z.string().optional(), geo: Geo });

/** A worker's own punch from their private link. */
export async function punch(link: { organizationId: string; candidateId: string; organization: Organization; candidate: { name: string } }, body: z.infer<typeof PunchBody>, now = new Date()) {
  const tdb = tenantDb(link.organizationId), tz = link.organization.timezone;
  const open = await tdb.timeEntry.findFirst({ where: { clockOut: null, application: { candidateId: link.candidateId } }, orderBy: { clockIn: 'desc' } });
  const geo = body.geo;
  if (body.action === 'in') {
    if (open) throw new HttpError(409, 'You’re already clocked in. Clock out first.');
    const apps = await assignmentsFor(tdb, link.candidateId);
    if (!apps.length) throw new HttpError(409, 'You’re not on an assignment right now, so there’s nothing to clock in to.');
    const app = body.applicationId ? apps.find((a) => a.id === body.applicationId) : apps.length === 1 ? apps[0] : null;
    if (!app) throw new HttpError(400, 'Choose the assignment you’re working.');
    if (hasFeature(link.organization, 'onboarding') && link.organization.onboardingEnforcement === 'block' && await onboardingGaps(tdb, link.candidateId)) {
      throw new HttpError(409, 'Finish your new-hire steps before clocking in. If you’re stuck, contact your recruiter.');
    }
    const fence = await siteCheck(tdb, link.organization, app.jobId, geo);
    const shift = await matchShift(tdb, app.id, now, tz);
    const e = await tdb.timeEntry.create({ data: { applicationId: app.id, shiftId: shift?.id ?? null, clockIn: now, inLat: geo?.lat, inLng: geo?.lng, inAccuracy: geo?.accuracy, inDistanceM: fence.distanceM, offSite: fence.outside } as never });
    // A double tap can race past the check above; keep only the first open entry.
    const opens = await tdb.timeEntry.findMany({ where: { clockOut: null, application: { candidateId: link.candidateId } }, orderBy: [{ clockIn: 'asc' }, { createdAt: 'asc' }], select: { id: true } });
    if (opens.length > 1 && opens[0].id !== e.id) { await tdb.timeEntry.deleteMany({ where: { id: e.id } }); throw new HttpError(409, 'You’re already clocked in.'); }
    await logActivity(link.organizationId, `${link.candidate.name} clocked in (${app.job.title}) at ${localTime(now, tz)}${offSiteNote(fence)}`);
    return { entryId: e.id, message: `Clocked in at ${fmtTime(now, tz)}.` };
  }
  if (!open) throw new HttpError(409, 'You’re not clocked in.');
  if (body.action === 'break-start') {
    if (open.breakStartedAt) throw new HttpError(409, 'You’re already on a break.');
    await tdb.timeEntry.updateMany({ where: { id: open.id, clockOut: null }, data: { breakStartedAt: now } });
    return { entryId: open.id, message: `Break started at ${fmtTime(now, tz)}.` };
  }
  const breakAdd = open.breakStartedAt ? Math.round((now.getTime() - open.breakStartedAt.getTime()) / 60000) : 0;
  if (body.action === 'break-end') {
    if (!open.breakStartedAt) throw new HttpError(409, 'You’re not on a break.');
    await tdb.timeEntry.updateMany({ where: { id: open.id, clockOut: null }, data: { breakStartedAt: null, breakMinutes: open.breakMinutes + breakAdd } });
    return { entryId: open.id, message: `Back from a ${breakAdd}-minute break.` };
  }
  const outFence = await siteCheck(tdb, link.organization, (await tdb.application.findFirst({ where: { id: open.applicationId }, select: { jobId: true } }))!.jobId, geo, true);
  await tdb.timeEntry.updateMany({ where: { id: open.id, clockOut: null }, data: { clockOut: now, breakStartedAt: null, breakMinutes: open.breakMinutes + breakAdd, outLat: geo?.lat, outLng: geo?.lng, outAccuracy: geo?.accuracy, outDistanceM: outFence.distanceM, ...(outFence.outside ? { offSite: true } : {}) } });
  const worked = workedMinutes({ clockIn: open.clockIn, clockOut: now, breakMinutes: open.breakMinutes + breakAdd });
  const long = (now.getTime() - open.clockIn.getTime()) / 3600e3 > MAX_OPEN_HOURS;
  await logActivity(link.organizationId, `${link.candidate.name} clocked out at ${localTime(now, tz)} (${(worked / 60).toFixed(2)} h)${long ? ' — check this entry, it ran over 16 hours' : ''}${offSiteNote(outFence)}`);
  return { entryId: open.id, message: `Clocked out at ${fmtTime(now, tz)}. You worked ${Math.floor(worked / 60)}h ${Math.round(worked % 60)}m.${long ? ' That’s a long shift — your recruiter will check it.' : ''}` };
}
/**
 * Checks a punch against the job site's geofence. In block mode an off-site (or location-less) punch is refused;
 * in flag mode it's saved and marked for review. Clocking out is never blocked — people must be able to stop the clock.
 */
async function siteCheck(tdb: TenantDb, org: Organization, jobId: string, geo: { lat: number; lng: number; accuracy?: number } | undefined, clockOut = false): Promise<FenceResult> {
  if (org.geofenceMode === 'off') return { distanceM: null, outside: false, reason: 'no-site' };
  const job = await tdb.job.findFirst({ where: { id: jobId }, select: { siteLat: true, siteLng: true, geofenceMeters: true } });
  const r = checkFence(job ? fenceOf(job) : null, geo);
  if (r.outside && org.geofenceMode === 'block' && !clockOut) {
    throw new HttpError(403, r.reason === 'no-location'
      ? 'Allow location for this page to clock in — your company checks that you’re at the job site.'
      : `You’re about ${howFar(r.distanceM!)} from the job site. Clock in when you get there, or contact your recruiter.`);
  }
  return r;
}
const offSiteNote = (r: FenceResult) => (!r.outside ? '' : r.reason === 'no-location' ? ' — no location shared' : ` — ${howFar(r.distanceM!)} from the site`);
const fmtTime = (d: Date, tz: string) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });

/** What the worker's page shows: assignments, the open entry and the last week of punches. */
export async function clockState(orgId: string, candidateId: string, tz: string) {
  const tdb = tenantDb(orgId);
  const [apps, open, recent] = await Promise.all([
    assignmentsFor(tdb, candidateId),
    tdb.timeEntry.findFirst({ where: { clockOut: null, application: { candidateId } }, orderBy: { clockIn: 'desc' } }),
    tdb.timeEntry.findMany({ where: { application: { candidateId }, clockOut: { not: null }, clockIn: { gte: new Date(Date.now() - 8 * 864e5) } }, orderBy: { clockIn: 'desc' }, take: 20, include: { application: { select: { job: { select: { title: true } } } } } }),
  ]);
  return {
    timezone: tz,
    assignments: apps.map((a) => ({ id: a.id, label: [a.job.title, a.job.client?.name].filter(Boolean).join(' — ') })),
    open: open ? { id: open.id, applicationId: open.applicationId, clockIn: open.clockIn.toISOString(), onBreak: !!open.breakStartedAt, breakStartedAt: open.breakStartedAt?.toISOString() ?? null, breakMinutes: open.breakMinutes } : null,
    recent: recent.map((e) => ({ id: e.id, date: localDate(e.clockIn, tz), job: e.application.job.title, in: e.clockIn.toISOString(), out: e.clockOut!.toISOString(), breakMinutes: e.breakMinutes, minutes: Math.round(workedMinutes(e)) })),
  };
}

/**
 * Turns a week's closed time entries into draft timesheets (regular vs overtime across assignments).
 * Approved or paid timesheets are never touched.
 */
export async function fillTimesheets(tdb: TenantDb, weekEnding: string, tz: string) {
  const { from, to } = weekRange(weekEnding, tz);
  const rows = await tdb.timeEntry.findMany({ where: { clockIn: { gte: from, lt: to } }, include: { application: { include: { candidate: { select: { name: true } }, job: true } } } });
  const entries: Entry[] = rows.map((r) => ({ id: r.id, applicationId: r.applicationId, candidateId: r.application.candidateId, clockIn: r.clockIn, clockOut: r.clockOut, breakMinutes: r.breakMinutes }));
  const open = rows.filter((r) => !r.clockOut).map((r) => r.application.candidate.name);
  const week = new Date(`${weekEnding}T00:00:00Z`);
  const filled: string[] = [], locked: string[] = [];
  for (const s of splitWeek(entries, tz).filter((x) => x.weekEnding === weekEnding)) {
    const app = rows.find((r) => r.applicationId === s.applicationId)!.application;
    const hrs = { regularHours: s.regularHours, overtimeHours: s.overtimeHours };
    const existing = await tdb.timesheet.findFirst({ where: { applicationId: app.id, weekEnding: week } });
    if (existing && existing.status !== 'DRAFT') { locked.push(app.candidate.name); continue; }
    if (existing) await tdb.timesheet.updateMany({ where: { id: existing.id, status: 'DRAFT' }, data: hrs });
    else {
      try { await tdb.timesheet.create({ data: { applicationId: app.id, weekEnding: week, ...hrs, payRate: app.job.payRate ?? 0, billRate: app.job.billRate ?? 0 } as never }); }
      catch (e) { if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e; await tdb.timesheet.updateMany({ where: { applicationId: app.id, weekEnding: week, status: 'DRAFT' }, data: hrs }); }
    }
    filled.push(app.candidate.name);
  }
  return { filled: filled.length, locked: [...new Set(locked)], openEntries: [...new Set(open)] };
}

/** Refuses edits to a punch whose week is already approved or paid. */
export async function assertWeekOpen(tdb: TenantDb, applicationId: string, at: Date, tz: string) {
  const d = localDate(at, tz), dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + ((7 - dt.getUTCDay()) % 7));
  const t = await tdb.timesheet.findFirst({ where: { applicationId, weekEnding: dt, status: { in: ['APPROVED', 'PAID'] } } });
  if (t) throw new HttpError(409, 'That week’s timesheet is already approved. Reopen it before changing punches.');
}

/** Sends a worker a long-lived private time clock link (replacing any earlier one). */
export async function sendClockLink(org: Organization, user: User, candidateId: string, channels: Channel[]) {
  const tdb = tenantDb(org.id);
  const c = await tdb.candidate.findFirst({ where: { id: candidateId } });
  if (!c) throw new HttpError(404, 'That candidate was deleted.');
  if (!(await assignmentsFor(tdb, c.id)).length) throw new HttpError(409, `${c.name} isn’t on an assignment, so there’s nothing to clock in to.`);
  await tdb.workerLink.updateMany({ where: { candidateId: c.id, kind: 'timeclock', revokedAt: null }, data: { revokedAt: new Date() } });
  const token = newToken();
  await tdb.workerLink.create({ data: { candidateId: c.id, tokenHash: sha256(token), kind: 'timeclock', expiresAt: new Date(Date.now() + 365 * 864e5) } as never });
  const link = `${appUrl()}/shifts/${token}`, company = org.shortName ?? org.name, first = c.name.split(' ')[0] || 'there';
  const msg = (ch: Channel) => ch === 'sms'
    ? { subject: '', text: `${company}: hi ${first}, clock in and out for your shifts here (save this link): ${link}` }
    : { subject: `Your time clock for ${company}`, text: `Hi ${first},\n\nUse this private link to clock in and out, take breaks and see your shifts. Save it to your phone’s home screen — it’s just for you, so please don’t share it.\n\n${link}\n\nThank you,\n${company}` };
  const results: { channel: Channel; problem: string | null }[] = [];
  for (const ch of channels) results.push({ channel: ch, problem: await deliver(tdb, c, ch, msg(ch), { name: company, replyTo: user.email }, user.id) });
  const sent = results.filter((r) => !r.problem).map((r) => r.channel);
  await logActivity(org.id, sent.length ? `Sent ${c.name} a time clock link by ${sent.map((x) => (x === 'sms' ? 'text' : 'email')).join(' and ')}` : `Couldn’t send ${c.name} a time clock link`, user.id);
  return { sent, problems: results.filter((r) => r.problem).map((r) => `${r.channel === 'sms' ? 'Text' : 'Email'}: ${r.problem}`) };
}
