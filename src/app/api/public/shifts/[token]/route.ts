import { z } from 'zod';
import { tenantDb, logActivity } from '@/lib/tenant';
import { resolveWorkerLink } from '@/lib/schedule-server';
import { dayLabel, clock } from '@/lib/schedule';
import { hasFeature } from '@/lib/plans';
import { clockState } from '@/lib/timeclock-server';
import { workerOnboarding } from '@/lib/onboarding-server';
import { workerEngagement } from '@/lib/engagement-server';
import { limited } from '@/lib/rate-limit';
import { respondToOffer, workerOffers } from '@/lib/open-shifts';
import { HttpError } from '@/lib/tenant';

type Ctx = { params: { token: string } };
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const gone = () => Response.json({ error: 'This link has expired. Ask your recruiter to send your schedule again.' }, { status: 404 });


/** The worker's upcoming shifts they've been told about (from yesterday on, for 60 days). */
export async function GET(_req: Request, { params }: Ctx) {
  const link = await resolveWorkerLink(params.token);
  if (!link) return gone();
  const tdb = tenantDb(link.organizationId);
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const shifts = await tdb.shift.findMany({
    where: { notifiedAt: { not: null }, application: { candidateId: link.candidateId }, date: { gte: new Date(today.getTime() - 864e5), lte: new Date(today.getTime() + 60 * 864e5) } },
    include: { application: { select: { job: { select: { title: true, location: true, client: { select: { name: true } } } } } } }, orderBy: [{ date: 'asc' }, { start: 'asc' }],
  });
  const o = link.organization;
  return Response.json({
    offers: hasFeature(o, 'scheduling') ? await workerOffers(link.organizationId, link.candidateId) : [],
    engagement: hasFeature(o, 'engagement') ? await workerEngagement(link.organizationId, link.candidateId) : null,
    onboarding: hasFeature(o, 'onboarding') ? await workerOnboarding(link.organizationId, link.candidateId) : [],
    clock: hasFeature(o, 'timeclock') ? await clockState(link.organizationId, link.candidateId, o.timezone) : null,
    company: o.shortName ?? o.name, brandColor: o.brandColor, contactEmail: o.applyEmail ?? null, logoUrl: o.logoUrl ?? null, firstName: link.candidate.name.split(' ')[0],
    shifts: shifts.map((s) => ({
      id: s.id, date: ymd(s.date), start: s.start, end: s.end, breakMinutes: s.breakMinutes, unit: s.unit, notes: s.notes,
      job: s.application.job.title, client: s.application.job.client?.name ?? null, location: s.application.job.location,
      // A shift edited since the last notice shows as "being updated" rather than leaking unsent changes.
      state: s.cancelled ? 'cancelled' : !s.notified ? 'updating' : s.response.toLowerCase(), past: ymd(s.date) < ymd(today),
    })),
  });
}

const Body = z.object({ shiftId: z.string(), response: z.enum(['CONFIRMED', 'DECLINED']), reason: z.string().max(300, 'Keep it under 300 characters.').optional() });

/** Confirm or decline one shift. */
export async function POST(req: Request, { params }: Ctx) {
  if (await limited('shifts', params.token.slice(0, 20), 60, 600e3)) return Response.json({ error: 'Too many requests. Try again in a few minutes.' }, { status: 429 });
  const link = await resolveWorkerLink(params.token);
  if (!link) return gone();
  const raw = await req.json().catch(() => null);
  const offer = z.object({ offerId: z.string(), accept: z.boolean() }).safeParse(raw);
  if (offer.success) {
    // Picking up (or passing on) an open shift.
    try { return Response.json(await respondToOffer(link.organizationId, link.candidate, offer.data.offerId, offer.data.accept)); }
    catch (e) { if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
  }
  const b = Body.safeParse(raw);
  if (!b.success) return Response.json({ error: b.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  const tdb = tenantDb(link.organizationId);
  const s = await tdb.shift.findFirst({ where: { id: b.data.shiftId, application: { candidateId: link.candidateId } } });
  if (!s) return Response.json({ error: 'That shift isn’t on your schedule.' }, { status: 404 });
  const today = new Date().toISOString().slice(0, 10);
  if (s.cancelled) return Response.json({ error: 'That shift was cancelled.' }, { status: 409 });
  if (!s.notified) return Response.json({ error: 'This shift is being updated. You’ll get the new details shortly.' }, { status: 409 });
  if (ymd(s.date) < today) return Response.json({ error: 'That shift has already passed.' }, { status: 409 });
  await tdb.shift.updateMany({ where: { id: s.id }, data: { response: b.data.response, respondedAt: new Date(), declineReason: b.data.response === 'DECLINED' ? b.data.reason?.trim() || null : null } });
  await logActivity(link.organizationId, `${link.candidate.name} ${b.data.response === 'CONFIRMED' ? 'confirmed' : 'can’t make'} the ${dayLabel(ymd(s.date))} ${clock(s.start)}–${clock(s.end)} shift${b.data.response === 'DECLINED' && b.data.reason ? `: “${b.data.reason.trim()}”` : ''}`);
  return Response.json({ ok: true });
}
