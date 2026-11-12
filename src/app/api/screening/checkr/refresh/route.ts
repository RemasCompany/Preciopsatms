import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { refreshAccount } from '@/lib/checkr';

/** Asks Checkr whether it has approved the company's account yet. */
export const POST = withApi(async () => {
  const { tdb } = await requireApiContext({ minRole: 'ADMIN', feature: 'credentials' });
  const ok = await refreshAccount(tdb);
  if (ok === null) throw new HttpError(409, 'Connect your Checkr account first.');
  return Response.json({ ready: ok });
});
