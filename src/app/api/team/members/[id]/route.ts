import { z } from 'zod';
import { Role } from '@prisma/client';
import { db } from '@/lib/db';
import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { syncSeats } from '@/lib/stripe';

type Ctx = { params: { id: string } };

async function target(orgId: string, id: string) {
  const m = await db.membership.findFirst({ where: { id, organizationId: orgId }, include: { user: { select: { email: true, name: true } } } });
  if (!m) throw new HttpError(404, 'That person is no longer on your team.');
  return m;
}
const owners = (orgId: string) => db.membership.count({ where: { organizationId: orgId, role: 'OWNER' } });

/** Change a teammate's role. Only owners can make or unmake owners, and there is always at least one owner. */
export const PATCH = withApi(async (req: Request, { params }: Ctx) => {
  const { org, user, role: myRole } = await requireApiContext({ minRole: 'ADMIN', write: true });
  const { role } = z.object({ role: z.nativeEnum(Role) }).parse(await req.json());
  const m = await target(org.id, params.id);
  if ((m.role === 'OWNER' || role === 'OWNER') && myRole !== 'OWNER') throw new HttpError(403, 'Only an owner can change who is an owner.');
  if (m.role === 'OWNER' && role !== 'OWNER' && (await owners(org.id)) <= 1) throw new HttpError(409, 'Your company needs at least one owner. Make someone else an owner first.');
  await db.membership.update({ where: { id: m.id }, data: { role } });
  await logActivity(org.id, `Changed ${m.user.email} to ${role.toLowerCase()}`, user.id);
  return Response.json({ ok: true });
});

/** Remove a teammate. Their account stays; they lose access to this company. Seats sync to Stripe. */
export const DELETE = withApi(async (_req: Request, { params }: Ctx) => {
  const { org, user, role: myRole } = await requireApiContext({ minRole: 'ADMIN', write: true });
  const m = await target(org.id, params.id);
  if (m.userId === user.id) throw new HttpError(409, 'You can’t remove yourself.');
  if (m.role === 'OWNER' && myRole !== 'OWNER') throw new HttpError(403, 'Only an owner can remove an owner.');
  if (m.role === 'OWNER' && (await owners(org.id)) <= 1) throw new HttpError(409, 'Your company needs at least one owner.');
  await db.membership.delete({ where: { id: m.id } });
  await syncSeats(org.id).catch((e) => console.error('[team] seat sync failed', e));
  await logActivity(org.id, `Removed ${m.user.email} from the team`, user.id);
  return Response.json({ ok: true });
});
