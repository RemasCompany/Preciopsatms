import { requireApiContext, withApi } from '@/lib/tenant';
import { createKey, listKeys } from '@/lib/api-keys';

export const GET = withApi(async () => {
  const { tdb } = await requireApiContext({ minRole: 'ADMIN', feature: 'api' });
  return Response.json({ keys: await listKeys(tdb) });
});

/** Creates a key. The full key is in this answer only; afterwards just its first characters are shown. */
export const POST = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'api', write: true });
  return Response.json(await createKey(org, user, await req.json().catch(() => null)), { headers: { 'Cache-Control': 'no-store' } });
});
