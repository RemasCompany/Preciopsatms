import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { exportTime, getProgram, programTime } from '@/lib/vms-server';

type Ctx = { params: { id: string } };

/** Approved time for one week: ?week=YYYY-MM-DD lists it; &download=1 returns the upload file (&all=1 includes weeks already sent). */
export const GET = withApi(async (req: Request, { params }: Ctx) => {
  const u = new URL(req.url), week = u.searchParams.get('week') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || new Date(`${week}T00:00:00Z`).getUTCDay() !== 0) throw new HttpError(400, 'Choose a week-ending Sunday.');
  const download = u.searchParams.get('download') === '1';
  const { tdb, org, user } = await requireApiContext({ feature: 'vms', ...(download && { write: true }) });
  const prog = await getProgram(tdb, params.id);
  if (!download) return Response.json(await programTime(tdb, prog, week));
  const file = await exportTime(tdb, org, user, prog, week, u.searchParams.get('all') !== '1');
  const name = `${prog.name.replace(/[^\w-]+/g, '-').toLowerCase()}-time-${week}.csv`;
  return new Response(file.csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'X-Rows': String(file.rows), 'X-Left-Out': String(file.left.length) } });
});
