import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { refreshSso } from '@/lib/sso';

/** Checks with WorkOS whether IT has finished connecting the identity provider. */
export const POST = withApi(async () => {
  const { tdb } = await requireApiContext({ minRole: 'ADMIN', feature: 'sso' });
  const state = await refreshSso(tdb);
  if (!state) throw new HttpError(409, 'Add your email domain first.');
  return Response.json({ state });
});
