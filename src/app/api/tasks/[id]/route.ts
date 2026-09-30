import { requireApiContext, withApi, HttpError } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

/** Progress of a background task you queued: { status, sent, skipped, failed, total }. */
export const GET = withApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const { tdb, user } = await requireApiContext({});
  const t = await tdb.backgroundTask.findFirst({ where: { id: params.id, createdById: user.id } });
  if (!t) throw new HttpError(404, 'That send wasn’t found.');
  const p = (t.result ?? t.progress ?? {}) as { sent?: number; skipped?: number; failed?: number; total?: number };
  const total = (t.progress as { total?: number } | null)?.total ?? p.total ?? 0;
  return Response.json({ status: t.status, sent: p.sent ?? 0, skipped: p.skipped ?? 0, failed: p.failed ?? 0, total, error: t.status === 'failed' ? t.lastError : null, retrying: t.status === 'queued' && !!t.lastError });
});
