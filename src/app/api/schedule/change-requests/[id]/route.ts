import { requireApiContext, withApi } from '@/lib/tenant';
import { decideChange } from '@/lib/shift-changes';

/** Approve or decline a worker's request to give up or change a shift. */
export const POST = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'scheduling', write: true });
  return Response.json(await decideChange(org, user, params.id, await req.json().catch(() => null)));
});
