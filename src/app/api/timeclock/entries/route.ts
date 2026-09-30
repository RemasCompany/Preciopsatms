import { z } from 'zod';
import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { assignmentWhere } from '@/lib/schedule-server';
import { assertWeekOpen } from '@/lib/timeclock-server';
import { PunchTimes, parseBody, toInstants } from '@/lib/timeclock-schemas';
import { localDate, localTime } from '@/lib/timeclock';

/** Staff add a missed punch for a worker. The reason is kept with the entry. */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'timeclock', write: true });
  const b = parseBody(PunchTimes.extend({ applicationId: z.string().min(1, 'Choose a worker.') }), await req.json().catch(() => null));
  const tz = org.timezone;
  const { clockIn, clockOut } = toInstants(b, tz);
  const app = await tdb.application.findFirst({ where: { id: b.applicationId, ...assignmentWhere }, include: { candidate: { select: { name: true } } } });
  if (!app) throw new HttpError(404, 'That worker is no longer on this assignment.');
  await assertWeekOpen(tdb, app.id, clockIn, tz);
  const clash = await tdb.timeEntry.findFirst({ where: { application: { candidateId: app.candidateId }, clockIn: { lt: clockOut ?? new Date(8.64e15) }, OR: [{ clockOut: null }, { clockOut: { gt: clockIn } }] } });
  if (clash) throw new HttpError(409, `That overlaps ${app.candidate.name}’s entry starting ${localDate(clash.clockIn, tz)} ${localTime(clash.clockIn, tz)}.`);
  const e = await tdb.timeEntry.create({ data: { applicationId: app.id, clockIn, clockOut, breakMinutes: b.breakMinutes, source: 'STAFF', editedById: user.id, editedAt: new Date(), editReason: b.reason } as never });
  await logActivity(org.id, `Added a time entry for ${app.candidate.name} (${localDate(clockIn, tz)} ${localTime(clockIn, tz)}–${clockOut ? localTime(clockOut, tz) : 'open'}): ${b.reason}`, user.id);
  return Response.json({ id: e.id }, { status: 201 });
});
