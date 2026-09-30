import { requireApiContext, withApi } from '@/lib/tenant';
import { cancelOpenShift } from '@/lib/open-shifts';

/** Cancel an open shift: pending offers are withdrawn; anyone who already accepted keeps their shift. */
export const DELETE = withApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const { org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'scheduling', write: true });
  await cancelOpenShift(org, user, params.id);
  return Response.json({ ok: true });
});
