import { z } from 'zod';
import { db } from '@/lib/db';
import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { audit } from '@/lib/audit';

/** Require two-step sign-in for everyone on the team. Teammates without it are asked to set it up on their next page. */
export const PATCH = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', write: true });
  const b = z.object({ required: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, 'Invalid input');
  if (b.data.required && !user.totpEnabledAt) throw new HttpError(409, 'Turn on two-step sign-in for yourself first (My sign-in), so you know what your team will see.');
  await db.organization.update({ where: { id: org.id }, data: { requireTwoStep: b.data.required } });
  const missing = b.data.required ? await db.membership.count({ where: { organizationId: org.id, user: { totpEnabledAt: null } } }) : 0;
  await logActivity(org.id, b.data.required ? 'Required two-step sign-in for the team' : 'Stopped requiring two-step sign-in', user.id);
  await audit(org.id, user, 'settings.two_step', b.data.required ? `Required two-step sign-in for everyone (${missing} still to set it up)` : 'Stopped requiring two-step sign-in', { changes: { requireTwoStep: [org.requireTwoStep, b.data.required] }, req });
  return Response.json({ ok: true, missing });
});
