import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';

/** Take an announcement down (it disappears from everyone's page; emails already sent stay sent). */
export const DELETE = withApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const { org, user, tdb, role } = await requireApiContext({ minRole: 'RECRUITER', feature: 'messaging', write: true });
  const a = await tdb.announcement.findFirst({ where: { id: params.id } });
  if (!a) throw new HttpError(404, 'That announcement was already taken down.');
  if (a.createdById !== user.id && role !== 'OWNER' && role !== 'ADMIN') throw new HttpError(403, 'Only the person who posted it or an admin can take it down.');
  await tdb.announcement.deleteMany({ where: { id: a.id } });
  await logActivity(org.id, `Took down the announcement “${a.title}”`, user.id);
  return Response.json({ ok: true });
});
