import { z } from 'zod';
import { requireApiContext, withApi } from '@/lib/tenant';
import { db } from '@/lib/db';
import { isTimezone } from '@/lib/timeclock';
import { parseBody } from '@/lib/timeclock-schemas';
import { audit, diff } from '@/lib/audit';

/** The company's time zone, which decides the day and workweek of every punch. */
export const PATCH = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'timeclock', write: true });
  const { timezone } = parseBody(z.object({ timezone: z.string().refine(isTimezone, 'Choose a time zone.') }), await req.json().catch(() => null));
  await db.organization.update({ where: { id: org.id }, data: { timezone } });
  await audit(org.id, user, 'settings.timeclock', `Set the company time zone to ${timezone}`, { changes: diff(org, { timezone }), req });
  return Response.json({ ok: true });
});
