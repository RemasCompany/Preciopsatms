import { z } from 'zod';
import type { Organization, User } from '@prisma/client';
import { HttpError, logActivity, tenantDb, type TenantDb } from './tenant';
import { hasFeature } from './plans';
import { onboardingGaps } from './onboarding-server';
import { barredFrom } from './dnr';
import { ShiftFields, assertNoOverlap, assignmentWhere, checkTimes, deliver, parse, workerLink, type Channel } from './schedule-server';
import { clockLong, dayLabel, overlaps, overnight } from './schedule';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.');

export const CreateOpenShift = z.object({
  jobId: z.string().min(1, 'Choose a job.'),
  dates: z.array(DATE).min(1, 'Choose at least one day.').max(31, 'Add up to 31 days at a time.'),
  slots: z.coerce.number().int().min(1, 'How many people?').max(50, 'Up to 50 people per shift.'),
  ...ShiftFields,
});

/** Open shifts on one or more days for a job. Nothing is sent until they're offered. */
export async function createOpenShifts(tdb: TenantDb, org: Organization, user: User, body: unknown) {
  const b = parse(CreateOpenShift, body);
  checkTimes(b);
  const job = await tdb.job.findFirst({ where: { id: b.jobId } });
  if (!job) throw new HttpError(404, 'That job was deleted.');
  if (job.type === 'DIRECT_HIRE') throw new HttpError(400, 'Direct-hire jobs don’t have shifts.');
  const dates = [...new Set(b.dates)].sort();
  const today = ymd(new Date());
  if (dates[0] < today) throw new HttpError(400, 'That day has already passed.');
  await tdb.openShift.createMany({ data: dates.map((d) => ({ organizationId: org.id, jobId: job.id, date: new Date(`${d}T00:00:00Z`), start: b.start, end: b.end, breakMinutes: b.breakMinutes, unit: b.unit ?? null, notes: b.notes ?? null, slots: b.slots, createdById: user.id })) });
  await logActivity(org.id, `Posted ${dates.length === 1 ? `an open shift on ${dayLabel(dates[0])}` : `${dates.length} open shifts`} for ${job.title} (${b.slots} ${b.slots === 1 ? 'person' : 'people'})`, user.id);
  return { created: dates.length };
}

async function loadOpen(tdb: TenantDb, id: string) {
  const os = await tdb.openShift.findFirst({ where: { id }, include: { job: { select: { id: true, title: true, location: true, clientId: true, client: { select: { name: true } } } } } });
  if (!os) throw new HttpError(404, 'That open shift was deleted.');
  return os;
}
const times = (os: { date: Date; start: string; end: string; breakMinutes: number }) => ({ date: ymd(os.date), start: os.start, end: os.end, breakMinutes: os.breakMinutes });

/** Who can be offered this shift: workers on assignment to the job, minus anyone busy then or blocked by onboarding. */
export async function pool(tdb: TenantDb, org: Organization, id: string) {
  const os = await loadOpen(tdb, id);
  const apps = await tdb.application.findMany({ where: { ...assignmentWhere, jobId: os.jobId }, include: { candidate: { select: { id: true, name: true, email: true, phone: true, emailOptOut: true, smsOptOut: true } } }, orderBy: { candidate: { name: 'asc' } } });
  const d = ymd(os.date), prev = new Date(os.date.getTime() - 864e5), next = new Date(os.date.getTime() + 864e5);
  const busy = await tdb.shift.findMany({ where: { cancelled: false, date: { gte: prev, lte: next }, application: { candidateId: { in: apps.map((a) => a.candidateId) } } }, select: { date: true, start: true, end: true, breakMinutes: true, application: { select: { candidateId: true } } } });
  const offers = await tdb.shiftOffer.findMany({ where: { openShiftId: os.id }, select: { candidateId: true, status: true } });
  const block = hasFeature(org, 'onboarding') && org.onboardingEnforcement === 'block';
  const out = [];
  for (const a of apps) {
    const c = a.candidate;
    let reason: string | null = null;
    if (await barredFrom(tdb, c.id, os.job.clientId)) reason = 'On the do-not-return list';
    else if (busy.some((s) => s.application.candidateId === c.id && overlaps(times(os), times(s)))) reason = 'Already working then';
    else if (block && (await onboardingGaps(tdb, c.id))) reason = 'Onboarding isn’t finished';
    else if (!(c.phone && !c.smsOptOut) && !(c.email && !c.emailOptOut)) reason = 'No way to reach them';
    out.push({ candidateId: c.id, applicationId: a.id, name: c.name, canText: !!c.phone && !c.smsOptOut, canEmail: !!c.email && !c.emailOptOut, reason, offer: offers.find((o) => o.candidateId === c.id)?.status ?? null });
  }
  return { shift: os, date: d, workers: out };
}

const describe = (os: { date: Date; start: string; end: string; unit: string | null }, job: string) =>
  `${dayLabel(ymd(os.date), { weekday: 'long', month: 'short', day: 'numeric' })}, ${clockLong(os.start)}–${clockLong(os.end)}${overnight(os.start, os.end) ? ' (overnight)' : ''} · ${job}${os.unit ? ` · ${os.unit}` : ''}`;

export const OfferBody = z.object({ candidateIds: z.array(z.string()).max(500).optional(), channels: z.array(z.enum(['sms', 'email'])).min(1, 'Choose text, email or both.').max(2) });

/** Sends the shift to the pool (or chosen workers). Each worker gets one message with their private link; re-offering skips anyone already asked. */
export async function offerShift(org: Organization, user: User, id: string, body: unknown) {
  const tdb = tenantDb(org.id);
  const b = parse(OfferBody, body);
  const { shift: os, workers } = await pool(tdb, org, id);
  if (os.status !== 'OPEN') throw new HttpError(409, os.status === 'FILLED' ? 'This shift is already filled.' : 'This shift was cancelled.');
  if (ymd(os.date) < ymd(new Date())) throw new HttpError(409, 'That day has already passed.');
  const targets = workers.filter((w) => !w.reason && !w.offer && (!b.candidateIds || b.candidateIds.includes(w.candidateId)));
  if (!targets.length) throw new HttpError(409, workers.some((w) => w.offer) ? 'Everyone available has already been offered this shift.' : 'No one in this job’s pool is available for this shift.');
  const company = org.shortName ?? org.name, what = describe(os, os.job.title), left = os.slots - os.filled;
  let sent = 0;
  const problems: string[] = [];
  for (const w of targets) {
    const c = await tdb.candidate.findFirst({ where: { id: w.candidateId } });
    if (!c) continue;
    const link = await workerLink(org.id, c.id, ymd(os.date));
    const first = c.name.split(' ')[0] || 'there';
    const via: Channel[] = [];
    for (const ch of b.channels) {
      const msg = ch === 'sms'
        ? { subject: '', text: `${company}: open shift ${what}. ${left === 1 ? 'First to accept gets it' : `${left} spots, first come first served`}: ${link}` }
        : { subject: `Open shift: ${what}`, text: `Hi ${first},\n\nAn extra shift is open and you’re invited to pick it up:\n\n${what}${os.job.location ? `\n${os.job.location}` : ''}${os.notes ? `\n${os.notes}` : ''}\n\n${left === 1 ? 'The first person to accept gets it' : `${left} spots — first come, first served`}. Accept or pass here:\n${link}\n\nThank you,\n${company}` };
      const problem = await deliver(tdb, c, ch, msg, { name: company, replyTo: user.email }, user.id);
      if (problem) problems.push(`${c.name}: ${problem}`); else via.push(ch);
    }
    if (via.length) {
      await tdb.shiftOffer.create({ data: { openShiftId: os.id, candidateId: c.id, applicationId: w.applicationId, sentVia: via.join(',') } as never });
      sent++;
    }
  }
  await logActivity(org.id, `Offered the ${describe(os, os.job.title)} open shift to ${sent} worker${sent === 1 ? '' : 's'}`, user.id);
  return { sent, problems };
}

export async function cancelOpenShift(org: Organization, user: User, id: string) {
  const tdb = tenantDb(org.id);
  const os = await loadOpen(tdb, id);
  if (os.status === 'CANCELLED') throw new HttpError(409, 'This shift was already cancelled.');
  await tdb.$transaction(async (tx) => {
    await tx.openShift.updateMany({ where: { id: os.id }, data: { status: 'CANCELLED' } });
    await tx.shiftOffer.updateMany({ where: { openShiftId: os.id, status: 'OFFERED' }, data: { status: 'CANCELLED' } });
  });
  await logActivity(org.id, `Cancelled the ${describe(os, os.job.title)} open shift${os.filled ? ` (${os.filled} already accepted keep their shifts)` : ''}`, user.id);
}

/** Open offers for a worker's page. */
export async function workerOffers(orgId: string, candidateId: string) {
  const tdb = tenantDb(orgId);
  const offers = await tdb.shiftOffer.findMany({ where: { candidateId, status: { in: ['OFFERED', 'TAKEN'] }, openShift: { date: { gte: new Date(new Date().toISOString().slice(0, 10)) } } },
    include: { openShift: { include: { job: { select: { title: true, location: true, client: { select: { name: true } } } } } } }, orderBy: { openShift: { date: 'asc' } } });
  return offers.map((o) => ({ id: o.id, status: o.status === 'TAKEN' || o.openShift.status !== 'OPEN' ? 'taken' : 'open', date: ymd(o.openShift.date), start: o.openShift.start, end: o.openShift.end, breakMinutes: o.openShift.breakMinutes,
    unit: o.openShift.unit, notes: o.openShift.notes, job: o.openShift.job.title, client: o.openShift.job.client?.name ?? null, location: o.openShift.job.location }));
}

/**
 * A worker accepts or passes on an offer. Accepting is first come, first served: the open shift is locked,
 * re-checked (still open, spots left, no clash with their other shifts), then turned into a confirmed shift.
 */
export async function respondToOffer(orgId: string, candidate: { id: string; name: string }, offerId: string, accept: boolean) {
  const tdb = tenantDb(orgId);
  const offer = await tdb.shiftOffer.findFirst({ where: { id: offerId, candidateId: candidate.id }, include: { openShift: { include: { job: { select: { title: true } } } } } });
  if (!offer) throw new HttpError(404, 'That offer isn’t for you.');
  if (offer.status === 'ACCEPTED') throw new HttpError(409, 'You already have this shift.');
  const os = offer.openShift, what = describe(os, os.job.title);
  if (!accept) {
    await tdb.shiftOffer.updateMany({ where: { id: offer.id, status: 'OFFERED' }, data: { status: 'DECLINED', respondedAt: new Date() } });
    return { message: 'No problem — thanks for letting us know.' };
  }
  if (ymd(os.date) < ymd(new Date())) throw new HttpError(409, 'That shift has already passed.');
  const result = await tdb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`openshift:${os.id}`}))`;
    const now = await tx.openShift.findFirst({ where: { id: os.id } });
    if (!now || now.status !== 'OPEN' || now.filled >= now.slots) {
      await tx.shiftOffer.updateMany({ where: { id: offer.id, status: 'OFFERED' }, data: { status: 'TAKEN' } });
      return null;
    }
    await assertNoOverlap(tx as unknown as TenantDb, candidate.id, [times(now)]);
    const shift = await tx.shift.create({ data: { applicationId: offer.applicationId, date: now.date, start: now.start, end: now.end, breakMinutes: now.breakMinutes, unit: now.unit, notes: now.notes,
      notified: true, notifiedAt: new Date(), response: 'CONFIRMED', respondedAt: new Date() } as never });
    const filled = now.filled + 1;
    await tx.openShift.updateMany({ where: { id: now.id }, data: { filled, status: filled >= now.slots ? 'FILLED' : 'OPEN' } });
    await tx.shiftOffer.updateMany({ where: { id: offer.id }, data: { status: 'ACCEPTED', respondedAt: new Date(), shiftId: shift.id } });
    if (filled >= now.slots) await tx.shiftOffer.updateMany({ where: { openShiftId: now.id, status: 'OFFERED' }, data: { status: 'TAKEN' } });
    return { filled, slots: now.slots };
  });
  if (!result) throw new HttpError(409, 'Sorry — someone else already took this shift.');
  await logActivity(orgId, `${candidate.name} picked up the ${what} open shift (${result.filled} of ${result.slots} filled)`);
  return { message: `It’s yours — you’re confirmed for ${dayLabel(ymd(os.date))}, ${clockLong(os.start)}–${clockLong(os.end)}.` };
}
