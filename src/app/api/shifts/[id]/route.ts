import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { UpdateShift, assertNoOverlap, checkTimes, parse, shiftWarnings } from '@/lib/schedule-server';
import { dayLabel } from '@/lib/schedule';

type Ctx = { params: { id: string } };
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Edit a shift. If the worker was already told about it, it's flagged to go out again with the next publish. */
export const PATCH = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org } = await requireApiContext({ minRole: 'RECRUITER', feature: 'scheduling', write: true });
  const b = parse(UpdateShift, await req.json().catch(() => null));
  const s = await tdb.shift.findFirst({ where: { id: params.id }, include: { application: { select: { candidateId: true } } } });
  if (!s) throw new HttpError(404, 'That shift was deleted.');
  if (s.cancelled) throw new HttpError(409, 'This shift was cancelled. Add a new shift instead.');
  const next = { date: b.date ?? ymd(s.date), start: b.start ?? s.start, end: b.end ?? s.end, breakMinutes: b.breakMinutes ?? s.breakMinutes };
  checkTimes(next);
  await assertNoOverlap(tdb, s.application.candidateId, [next], s.id);
  const changedTimes = next.date !== ymd(s.date) || next.start !== s.start || next.end !== s.end || next.breakMinutes !== s.breakMinutes;
  const changed = changedTimes || (b.unit !== undefined && b.unit !== s.unit) || (b.notes !== undefined && b.notes !== s.notes);
  await tdb.shift.updateMany({ where: { id: s.id }, data: {
    date: new Date(`${next.date}T00:00:00Z`), start: next.start, end: next.end, breakMinutes: next.breakMinutes,
    ...(b.unit !== undefined ? { unit: b.unit } : {}), ...(b.notes !== undefined ? { notes: b.notes } : {}),
    // A changed shift must be re-sent and re-confirmed.
    ...(changed ? { notified: false, remindedAt: null, ...(changedTimes ? { response: 'PENDING' as const, respondedAt: null, declineReason: null } : {}) } : {}),
  } });
  return Response.json({ ok: true, needsNotice: changed && !!s.notifiedAt, warnings: await shiftWarnings(tdb, { credentials: hasFeature(org, 'credentials'), onboarding: hasFeature(org, 'onboarding') }, s.application.candidateId, [next.date]) });
});

/** Remove a shift. One the worker never heard about is deleted; one they were told about becomes a cancellation to send. */
export const DELETE = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'scheduling', write: true });
  const s = await tdb.shift.findFirst({ where: { id: params.id }, include: { application: { select: { candidate: { select: { name: true } } } } } });
  if (!s) throw new HttpError(404, 'That shift was deleted.');
  if (!s.notifiedAt || (s.cancelled && s.notified)) {
    await tdb.shift.deleteMany({ where: { id: s.id } });
    return Response.json({ ok: true, deleted: true });
  }
  await tdb.shift.updateMany({ where: { id: s.id }, data: { cancelled: true, notified: false } });
  await logActivity(org.id, `Cancelled ${s.application.candidate.name}’s ${dayLabel(ymd(s.date))} shift`, user.id);
  return Response.json({ ok: true, deleted: false });
});
