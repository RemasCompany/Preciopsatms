import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { CreateShift, assertNoOverlap, assignmentWhere, checkTimes, parse, shiftWarnings } from '@/lib/schedule-server';
import { dayLabel } from '@/lib/schedule';
import { onboardingGaps } from '@/lib/onboarding-server';

/** Add a shift on one or more days for a worker on assignment. Nothing is sent until the schedule is published. */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'scheduling', write: true });
  const b = parse(CreateShift, await req.json().catch(() => null));
  checkTimes(b);
  const app = await tdb.application.findFirst({ where: { id: b.applicationId, ...assignmentWhere }, include: { candidate: { select: { id: true, name: true } } } });
  if (!app) throw new HttpError(404, 'That worker is no longer on this assignment.');
  const dates = [...new Set(b.dates)].sort();
  if (hasFeature(org, 'onboarding') && org.onboardingEnforcement === 'block') {
    const gaps = await onboardingGaps(tdb, app.candidateId);
    if (gaps) throw new HttpError(409, `${app.candidate.name} can’t be scheduled until onboarding is finished (${gaps.left} required step${gaps.left === 1 ? '' : 's'} left).`);
  }
  await assertNoOverlap(tdb, app.candidateId, dates.map((date) => ({ date, start: b.start, end: b.end, breakMinutes: b.breakMinutes })));
  await tdb.shift.createMany({ data: dates.map((date) => ({ organizationId: org.id, applicationId: app.id, date: new Date(`${date}T00:00:00Z`), start: b.start, end: b.end, breakMinutes: b.breakMinutes, unit: b.unit ?? null, notes: b.notes ?? null })) });
  await logActivity(org.id, `Scheduled ${app.candidate.name}: ${dates.length === 1 ? dayLabel(dates[0]) : `${dates.length} shifts`}`, user.id);
  return Response.json({ created: dates.length, warnings: await shiftWarnings(tdb, { credentials: hasFeature(org, 'credentials'), onboarding: hasFeature(org, 'onboarding') }, app.candidateId, dates) }, { status: 201 });
});
