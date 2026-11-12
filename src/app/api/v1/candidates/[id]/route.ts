import { apiRoute } from '@/lib/api-keys';
import { candidateOut } from '@/lib/api-v1';
import { HttpError } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (_req, { tdb }, params) => {
  const c = await tdb.candidate.findFirst({ where: { id: params.id } });
  if (!c) throw new HttpError(404, 'No candidate with that id.');
  return Response.json(candidateOut(c));
});
