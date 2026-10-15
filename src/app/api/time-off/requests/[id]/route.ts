import { requireApiContext, withApi } from '@/lib/tenant';
import { decide } from '@/lib/leave';

/** Approve, deny or cancel a request. */
export const POST = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireApiContext({ minRole: 'RECRUITER', feature: 'timeoff', write: true });
  return Response.json(await decide(ctx, params.id, await req.json().catch(() => null)));
});
