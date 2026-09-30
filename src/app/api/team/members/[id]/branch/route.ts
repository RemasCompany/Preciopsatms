import { z } from 'zod';
import { db } from '@/lib/db';
import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';

/** A teammate's home branch (the app opens filtered to it). Admins set anyone's; people can set their own. */
export const PATCH = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user, role } = await requireApiContext({ write: true });
  const b = z.object({ branchId: z.string().nullable() }).safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, 'Invalid input');
  const m = await db.membership.findFirst({ where: { id: params.id, organizationId: org.id }, include: { user: { select: { email: true } } } });
  if (!m) throw new HttpError(404, 'That person is no longer on your team.');
  if (m.userId !== user.id && role !== 'OWNER' && role !== 'ADMIN') throw new HttpError(403, 'Only admins can change someone else’s branch.');
  const branch = b.data.branchId ? await tdb.branch.findFirst({ where: { id: b.data.branchId } }) : null;
  if (b.data.branchId && !branch) throw new HttpError(404, 'That branch was deleted.');
  await db.membership.updateMany({ where: { id: m.id, organizationId: org.id }, data: { branchId: branch?.id ?? null } });
  await logActivity(org.id, `${m.user.email}’s home branch: ${branch?.name ?? 'none'}`, user.id);
  return Response.json({ ok: true });
});
