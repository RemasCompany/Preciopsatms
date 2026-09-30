import { z } from 'zod';
import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { parseCoords } from '@/lib/geo';

const Body = z.union([
  z.object({ jobId: z.string(), clear: z.literal(true) }),
  z.object({ jobId: z.string(), coords: z.string().max(500), radius: z.number().int('Use whole metres.').min(50, 'Use at least 50 m — phones aren’t more precise than that.').max(5000, 'Keep it under 5,000 m.') }),
]);

/** Set or remove a job's site for the time clock geofence. */
export const PATCH = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'timeclock', write: true });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, b.error.issues.find((i) => i.path[0] === 'radius')?.message ?? 'Invalid input');
  const job = await tdb.job.findFirst({ where: { id: b.data.jobId } });
  if (!job) throw new HttpError(404, 'That job was deleted.');
  if ('clear' in b.data) {
    await tdb.job.updateMany({ where: { id: job.id }, data: { siteLat: null, siteLng: null, geofenceMeters: null } });
    await logActivity(org.id, `Removed the job site for ${job.title}`, user.id);
    return Response.json({ ok: true });
  }
  const c = parseCoords(b.data.coords);
  if (!c) throw new HttpError(400, 'Paste coordinates like 28.5383, -81.3792, or a Google Maps link with a pin.');
  await tdb.job.updateMany({ where: { id: job.id }, data: { siteLat: c.lat, siteLng: c.lng, geofenceMeters: b.data.radius } });
  await logActivity(org.id, `Set the job site for ${job.title} (${b.data.radius} m radius)`, user.id);
  return Response.json({ ok: true });
});
