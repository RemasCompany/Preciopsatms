import { apiRoute, page, paged } from '@/lib/api-keys';
import { since } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

/** GET /api/v1/applications?jobId=&candidateId=&stage=PLACED&updatedSince=…&limit=&cursor= */
export const GET = apiRoute(async (req, { tdb }) => {
  const { limit, after, args, u } = page(req);
  const q = (k: string) => u.searchParams.get(k)?.trim() || undefined;
  const rows = await tdb.application.findMany({ ...args, where: { ...after, ...since(u), jobId: q('jobId'), candidateId: q('candidateId'), ...(q('stage') ? { stage: q('stage')!.toUpperCase() as never } : {}) } });
  const { data, nextCursor } = paged(rows, limit);
  return Response.json({ data: data.map((a) => ({ id: a.id, jobId: a.jobId, candidateId: a.candidateId, stage: a.stage, source: a.source, rejectionReason: a.rejectionReason, stageChangedAt: a.stageChangedAt.toISOString(), createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString() })), nextCursor });
});
