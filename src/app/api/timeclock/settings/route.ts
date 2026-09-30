import { z } from 'zod';
import { requireApiContext, withApi } from '@/lib/tenant';
import { db } from '@/lib/db';
import { isTimezone } from '@/lib/timeclock';
import { parseBody } from '@/lib/timeclock-schemas';
import { audit, diff } from '@/lib/audit';

const Body = z.object({
  timezone: z.string().refine(isTimezone, 'Choose a time zone.').optional(),
  geofenceMode: z.enum(['off', 'flag', 'block'], { errorMap: () => ({ message: 'Choose off, flag or block.' }) }).optional(),
});

/** The company's time zone (which decides the day and workweek of every punch) and what to do with off-site punches. */
export const PATCH = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'timeclock', write: true });
  const b = parseBody(Body, await req.json().catch(() => null));
  const data = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) as { timezone?: string; geofenceMode?: string };
  if (!Object.keys(data).length) return Response.json({ ok: true });
  await db.organization.update({ where: { id: org.id }, data });
  const what = [data.timezone && `time zone ${data.timezone}`, data.geofenceMode && `off-site punches: ${data.geofenceMode}`].filter(Boolean).join('; ');
  await audit(org.id, user, 'settings.timeclock', `Changed time clock settings: ${what}`, { changes: diff(org, data), req });
  return Response.json({ ok: true });
});
