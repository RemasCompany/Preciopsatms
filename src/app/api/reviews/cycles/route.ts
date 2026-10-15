import { requireApiContext, withApi } from '@/lib/tenant';
import { startCycle } from '@/lib/reviews';

/** Start a review cycle for everyone current (or one department). Owners and admins. */
export const POST = withApi(async (req: Request) => {
  const ctx = await requireApiContext({ minRole: 'ADMIN', feature: 'reviews', write: true });
  return Response.json(await startCycle(ctx, await req.json().catch(() => null)), { status: 201 });
});
