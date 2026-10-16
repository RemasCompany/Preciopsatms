import { requireApiContext, withApi } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { scheduleReviews, saveSchedule, FREQUENCIES, BASES, type Frequency, type Basis } from '@/lib/review-schedule';
import { localDate } from '@/lib/timeclock';

/** The company's review schedule: how often people are reviewed, when, and how far ahead. Admins. */
export const PATCH = withApi(async (req: Request) => {
  const { org, user, tdb } = await requireApiContext({ minRole: 'ADMIN', feature: 'reviews', write: true });
  const saved = await saveSchedule(org.id, await req.json().catch(() => null));
  // Turning it on (or changing it) adds anything already within the lead time right away.
  const added = saved.reviewScheduleOn ? await scheduleReviews(tdb, saved, localDate(new Date(), saved.timezone)) : 0;
  await audit(org.id, user, 'review.schedule', saved.reviewScheduleOn
    ? `Review schedule on: ${FREQUENCIES[saved.reviewFrequency as Frequency]} by default, ${BASES[saved.reviewBasis as Basis].toLowerCase()}, added ${saved.reviewLeadDays} days ahead`
    : 'Turned off the review schedule');
  return Response.json({ ok: true, added });
});
