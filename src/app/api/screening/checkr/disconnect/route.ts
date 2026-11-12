import { requireApiContext, withApi } from '@/lib/tenant';
import { disconnect } from '@/lib/checkr';

/** Disconnects the company's Checkr account. Checks already ordered keep their history here; the reports stay in Checkr. */
export const POST = withApi(async () => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'credentials', write: true });
  await disconnect(org, user);
  return Response.json({ ok: true });
});
