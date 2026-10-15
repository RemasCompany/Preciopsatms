import { requireApiContext, withApi } from '@/lib/tenant';
import { terminate } from '@/lib/people';

/** End someone's employment on their last day. Owners and admins only. */
export const POST = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireApiContext({ minRole: 'ADMIN', feature: 'people', write: true });
  return Response.json(await terminate(ctx, params.id, await req.json().catch(() => null)));
});
