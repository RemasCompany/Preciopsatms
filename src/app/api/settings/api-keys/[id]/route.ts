import { requireApiContext, withApi } from '@/lib/tenant';
import { revokeKey } from '@/lib/api-keys';

/** Revokes a key: requests with it stop working at once. */
export const DELETE = withApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'api', write: true });
  await revokeKey(org, user, params.id);
  return Response.json({ ok: true });
});
