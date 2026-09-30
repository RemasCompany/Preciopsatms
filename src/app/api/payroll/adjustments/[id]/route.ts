import { requireApiContext, withApi, HttpError } from '@/lib/tenant';

export const DELETE = withApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const { tdb } = await requireApiContext({ minRole: 'ADMIN', feature: 'payrollRuns', write: true });
  const a = await tdb.payrollAdjustment.findFirst({ where: { id: params.id }, include: { item: { include: { run: { select: { status: true } } } } } });
  if (!a) throw new HttpError(404, 'That adjustment was removed.');
  if (a.item.run.status !== 'DRAFT') throw new HttpError(409, 'Only draft runs can change. Reopen the run first.');
  await tdb.payrollAdjustment.deleteMany({ where: { id: a.id } });
  return Response.json({ ok: true });
});
