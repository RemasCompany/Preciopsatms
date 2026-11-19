import { requireApiContext, withApi } from '@/lib/tenant';
import { decide } from '@/lib/job-changes';

/** Approve or decline (owners and admins), or cancel (them, or whoever proposed it). */
export const POST = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireApiContext({ minRole: 'RECRUITER', feature: 'people', write: true });
  return Response.json(await decide(ctx, params.id, await req.json().catch(() => null)));
});
