import { requireApiContext, withApi } from '@/lib/tenant';
import { portalLink } from '@/lib/sso';

/** Step 2: a link to WorkOS's setup portal, for the admin or their IT team to connect the identity provider. */
export const POST = withApi(async () => {
  const { tdb } = await requireApiContext({ minRole: 'ADMIN', feature: 'sso', write: true });
  return Response.json({ link: await portalLink(tdb) });
});
