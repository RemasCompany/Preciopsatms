import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';

export const DELETE = withApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', write: true });
  const { count } = await tdb.reportSchedule.deleteMany({ where: { id: params.id } });
  if (!count) throw new HttpError(404, 'That schedule was already removed.');
  await logActivity(org.id, 'Stopped a scheduled report', user.id);
  return Response.json({ ok: true });
});
