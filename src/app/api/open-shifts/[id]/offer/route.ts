import { requireApiContext, withApi } from '@/lib/tenant';
import { offerShift } from '@/lib/open-shifts';

/** Text/email the shift to the available pool (or chosen workers). First to accept gets it. */
export const POST = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'scheduling', write: true });
  return Response.json(await offerShift(org, user, params.id, await req.json().catch(() => null)));
});
