import { db } from '@/lib/db';
import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { clear } from '@/lib/two-step';

/**
 * For a teammate who lost their phone and their recovery codes: turns their two-step sign-in off so they can sign in
 * with their password and set it up again (they're asked to straight away if the company requires it).
 */
export const DELETE = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { org, user, role } = await requireApiContext({ minRole: 'ADMIN', write: true });
  const m = await db.membership.findFirst({ where: { id: params.id, organizationId: org.id }, include: { user: { select: { email: true, totpEnabledAt: true } } } });
  if (!m) throw new HttpError(404, 'That person is no longer on your team.');
  if (m.userId === user.id) throw new HttpError(409, 'Use My sign-in to change your own two-step sign-in.');
  if (m.role === 'OWNER' && role !== 'OWNER') throw new HttpError(403, 'Only an owner can reset an owner’s two-step sign-in.');
  if (!m.user.totpEnabledAt) throw new HttpError(409, `${m.user.email} doesn’t have two-step sign-in on.`);
  // One login can belong to several companies. An admin here mustn't be able to weaken it for the others.
  if (await db.membership.count({ where: { userId: m.userId, organizationId: { not: org.id } } })) throw new HttpError(409, `${m.user.email} also signs in to another company, so their two-step sign-in can’t be reset from here. They can sign in with a recovery code instead.`);
  await db.user.update({ where: { id: m.userId }, data: clear });
  await logActivity(org.id, `Reset ${m.user.email}’s two-step sign-in`, user.id);
  await audit(org.id, user, 'team.two_step_reset', `Reset ${m.user.email}’s two-step sign-in so they can set it up again`, { targetType: 'user', targetId: m.userId, req });
  return Response.json({ ok: true });
});
