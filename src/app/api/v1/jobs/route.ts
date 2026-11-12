import { apiRoute, page, paged } from '@/lib/api-keys';
import { createJob, jobOut, since } from '@/lib/api-v1';
import { logActivity } from '@/lib/tenant';

export const dynamic = 'force-dynamic';
const STATUSES = ['OPEN', 'ON_HOLD', 'FILLED', 'CLOSED'];

/** GET /api/v1/jobs?status=OPEN&updatedSince=…&limit=&cursor= */
export const GET = apiRoute(async (req, { tdb }) => {
  const { limit, after, args, u } = page(req);
  const status = u.searchParams.get('status')?.toUpperCase();
  const rows = await tdb.job.findMany({ ...args, where: { ...after, ...since(u), ...(status && STATUSES.includes(status) ? { status: status as never } : {}) }, include: { client: { select: { id: true, name: true } } } });
  const { data, nextCursor } = paged(rows, limit);
  return Response.json({ data: data.map(jobOut), nextCursor });
});

/** POST /api/v1/jobs — opens a job. It isn't published to the careers page or job boards unless "publish": true. */
export const POST = apiRoute(async (req, { org, tdb }) => {
  const j = await createJob(tdb, await req.json().catch(() => null));
  await logActivity(org.id, `Job “${j.title}” added through the API`);
  return Response.json(jobOut(j), { status: 201 });
});
