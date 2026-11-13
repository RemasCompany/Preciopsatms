import { requireApiContext, withApi } from '@/lib/tenant';
import { disconnect } from '@/lib/online-payments';

/** Stops offering online payment. The firm's Stripe account, and the money in it, stay theirs. */
export const POST = withApi(async () => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'invoicing', write: true });
  await disconnect(org, user);
  return Response.json({ ok: true });
});
