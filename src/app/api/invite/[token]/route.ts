import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';
import { sha256 } from '@/lib/tokens';
import { syncSeats, seatLimitReached } from '@/lib/stripe';
import { withApi, HttpError } from '@/lib/tenant';
import { audit } from '@/lib/audit';

type Ctx = { params: { token: string } };
const INVALID = 'This invite link is invalid, expired or already used. Ask for a new one.';

async function findInvite(token: string) {
  const inv = await db.invite.findUnique({ where: { tokenHash: sha256(token) }, include: { organization: true } });
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) return null;
  return inv;
}

/** Public: who is inviting, and whether the invited email already has an account. */
export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const inv = await findInvite(params.token);
  if (!inv) throw new HttpError(404, INVALID);
  const existing = await db.user.findUnique({ where: { email: inv.email }, select: { id: true } });
  return Response.json({ company: inv.organization.name, email: inv.email, role: inv.role, hasAccount: !!existing });
});

const Body = z.object({ name: z.string().trim().min(2, 'Enter your full name.').max(120).optional(), password: z.string().min(1, 'Enter your password.').max(200) });

/** Public: accept. New people create an account; existing users confirm their password. Returns the org to sign in to. */
export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const inv = await findInvite(params.token);
  if (!inv) throw new HttpError(404, INVALID);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
  const { name, password } = parsed.data;

  let user = await db.user.findUnique({ where: { email: inv.email } });
  if (user) {
    if (!(await bcrypt.compare(password, user.passwordHash))) throw new HttpError(401, 'That password doesn’t match your Preciops account.');
  } else {
    if (!name) throw new HttpError(400, 'Enter your full name.');
    if (password.length < 10) throw new HttpError(400, 'Use at least 10 characters for your password.');
    // The invite link went to this address, so it's already confirmed.
    user = await db.user.create({ data: { email: inv.email, name, passwordHash: await bcrypt.hash(password, 12), emailVerifiedAt: new Date() } });
  }
  const already = await db.membership.findUnique({ where: { userId_organizationId: { userId: user.id, organizationId: inv.organizationId } } });
  if (!already) {
    const members = await db.membership.count({ where: { organizationId: inv.organizationId } });
    if (seatLimitReached(inv.organization, members)) throw new HttpError(402, `${inv.organization.name} has no free seats on its plan. Ask them to upgrade, then accept again.`);
    await db.membership.create({ data: { userId: user.id, organizationId: inv.organizationId, role: inv.role } });
  }
  await db.invite.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
  await db.activity.create({ data: { organizationId: inv.organizationId, text: `${user.name ?? user.email} joined the team`, actorId: user.id } });
  if (!already) await audit(inv.organizationId, user, 'team.join', `${user.email} accepted an invite and joined as ${inv.role.toLowerCase()}`, { targetType: 'user', targetId: user.id, req });
  await syncSeats(inv.organizationId).catch((e) => console.error('[invite] seat sync failed', e));
  return Response.json({ email: user.email, orgId: inv.organizationId });
});
