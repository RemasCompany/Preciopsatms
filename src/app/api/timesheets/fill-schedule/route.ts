import { z } from 'zod';
import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { parseWeek } from '@/lib/weeks';
import { fillFromSchedule } from '@/lib/schedule-fill';

/** Fill blank timesheets for a week from the published schedule (never overwrites entered or clocked hours). */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'scheduling', write: true });
  const b = z.object({ week: z.string() }).safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, 'Choose a week.');
  const r = await fillFromSchedule(tdb, parseWeek(b.data.week), org.timezone);
  if (r.filled) await logActivity(org.id, `Filled ${r.filled} timesheet${r.filled === 1 ? '' : 's'} for the week ending ${r.week} from the schedule`, user.id);
  return Response.json(r);
});
