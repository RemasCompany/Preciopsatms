import { requireApiContext, withApi } from '@/lib/tenant';
import { changePay } from '@/lib/people';

/** A raise, promotion or correction, effective on a date. Owners and admins only. */
export const POST = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireApiContext({ minRole: 'ADMIN', feature: 'people', write: true });
  return Response.json(await changePay(ctx, params.id, await req.json().catch(() => null)), { status: 201 });
});
