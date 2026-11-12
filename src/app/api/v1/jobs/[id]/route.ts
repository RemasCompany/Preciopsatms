import { apiRoute } from '@/lib/api-keys';
import { jobOut } from '@/lib/api-v1';
import { HttpError } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (_req, { tdb }, params) => {
  const j = await tdb.job.findFirst({ where: { id: params.id }, include: { client: { select: { id: true, name: true } } } });
  if (!j) throw new HttpError(404, 'No job with that id.');
  return Response.json(jobOut(j));
});
