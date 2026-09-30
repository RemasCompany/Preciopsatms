import { z } from 'zod';
import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { assertWeekOpen } from '@/lib/timeclock-server';
import { PunchTimes, parseBody, toInstants } from '@/lib/timeclock-schemas';
import { localDate, localTime } from '@/lib/timeclock';

type Ctx = { params: { id: string } };

/** Correct a punch. The first edit keeps the worker's original times; every edit needs a reason. */
export const PATCH = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'timeclock', write: true });
  const b = parseBody(PunchTimes, await req.json().catch(() => null));
  const tz = org.timezone;
  const e = await tdb.timeEntry.findFirst({ where: { id: params.id }, include: { application: { select: { candidateId: true, candidate: { select: { name: true } } } } } });
  if (!e) throw new HttpError(404, 'That time entry was deleted.');
  const { clockIn, clockOut } = toInstants(b, tz);
  await assertWeekOpen(tdb, e.applicationId, e.clockIn, tz);
  await assertWeekOpen(tdb, e.applicationId, clockIn, tz);
  const clash = await tdb.timeEntry.findFirst({ where: { id: { not: e.id }, application: { candidateId: e.application.candidateId }, clockIn: { lt: clockOut ?? new Date(8.64e15) }, OR: [{ clockOut: null }, { clockOut: { gt: clockIn } }] } });
  if (clash) throw new HttpError(409, `That overlaps another entry starting ${localDate(clash.clockIn, tz)} ${localTime(clash.clockIn, tz)}.`);
  await tdb.timeEntry.updateMany({ where: { id: e.id }, data: {
    clockIn, clockOut, breakMinutes: b.breakMinutes, breakStartedAt: clockOut ? null : e.breakStartedAt,
    originalClockIn: e.originalClockIn ?? (e.source === 'WORKER' ? e.clockIn : null), originalClockOut: e.originalClockOut ?? (e.source === 'WORKER' ? e.clockOut : null),
    editedById: user.id, editedAt: new Date(), editReason: b.reason,
  } });
  const t = (d: Date | null) => (d ? `${localDate(d, tz)} ${localTime(d, tz)}` : 'open');
  await logActivity(org.id, `Edited ${e.application.candidate.name}’s time entry ${t(e.clockIn)}–${t(e.clockOut)} → ${t(clockIn)}–${t(clockOut)}: ${b.reason}`, user.id);
  return Response.json({ ok: true });
});

/** Remove a punch made by mistake. The deletion and its reason are logged. */
export const DELETE = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'timeclock', write: true });
  const { reason } = parseBody(z.object({ reason: z.string().trim().min(3, 'Say why you’re removing it.').max(300) }), await req.json().catch(() => null));
  const e = await tdb.timeEntry.findFirst({ where: { id: params.id }, include: { application: { select: { candidate: { select: { name: true } } } } } });
  if (!e) throw new HttpError(404, 'That time entry was deleted.');
  await assertWeekOpen(tdb, e.applicationId, e.clockIn, org.timezone);
  await tdb.timeEntry.deleteMany({ where: { id: e.id } });
  const tz = org.timezone;
  await logActivity(org.id, `Deleted ${e.application.candidate.name}’s time entry ${localDate(e.clockIn, tz)} ${localTime(e.clockIn, tz)}–${e.clockOut ? localTime(e.clockOut, tz) : 'open'}: ${reason}`, user.id);
  return Response.json({ ok: true });
});
