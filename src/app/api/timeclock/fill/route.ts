import { z } from 'zod';
import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { parseWeek } from '@/lib/weeks';
import { fillTimesheets } from '@/lib/timeclock-server';
import { parseBody } from '@/lib/timeclock-schemas';

/** Fill the week's draft timesheets from clocked hours (overtime split across assignments). */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'timeclock', write: true });
  const { week } = parseBody(z.object({ week: z.string() }), await req.json().catch(() => null));
  let w: Date;
  try { w = parseWeek(week); } catch { throw new HttpError(400, 'Weeks end on a Sunday.'); }
  const r = await fillTimesheets(tdb, w.toISOString().slice(0, 10), org.timezone);
  await logActivity(org.id, `Filled ${r.filled} timesheet${r.filled === 1 ? '' : 's'} from the time clock for the week ending ${week}`, user.id);
  return Response.json(r);
});
