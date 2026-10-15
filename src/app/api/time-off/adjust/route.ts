import { requireApiContext, withApi } from '@/lib/tenant';
import { adjust } from '@/lib/leave';

/** Add or take away hours: starting balances, corrections, payouts. Owners and admins. */
export const POST = withApi(async (req: Request) => {
  const ctx = await requireApiContext({ minRole: 'ADMIN', feature: 'timeoff', write: true });
  return Response.json(await adjust(ctx, await req.json().catch(() => null)), { status: 201 });
});
