import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { revokePortal, sendPortalLink } from '@/lib/portal-server';

const Body = z.object({ contactId: z.string().min(1), action: z.enum(['send', 'revoke']) });

/** Staff: email a client contact their portal link, or turn their access off. */
export const POST = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'clientPortal', write: true });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, 'Invalid input');
  if (b.data.action === 'revoke') return Response.json({ revoked: await revokePortal(org, b.data.contactId, user) });
  await sendPortalLink(org, b.data.contactId, user);
  return Response.json({ ok: true });
});
