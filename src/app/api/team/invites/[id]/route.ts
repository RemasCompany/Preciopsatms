import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { audit } from '@/lib/audit';

/** Revoke a pending invite; its link stops working. */
export const DELETE = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', write: true });
  const inv = await tdb.invite.findFirst({ where: { id: params.id, acceptedAt: null } });
  if (!inv) throw new HttpError(404, 'That invite was already accepted or revoked.');
  await tdb.invite.deleteMany({ where: { id: inv.id } });
  await logActivity(org.id, `Revoked the invite for ${inv.email}`, user.id);
  await audit(org.id, user, 'team.invite_revoke', `Revoked the invite for ${inv.email}`, { targetType: 'invite', targetId: inv.id, req });
  return Response.json({ ok: true });
});
