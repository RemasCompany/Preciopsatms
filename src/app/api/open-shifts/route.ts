import { requireApiContext, withApi } from '@/lib/tenant';
import { createOpenShifts } from '@/lib/open-shifts';

/** Post open shifts for a job (one per chosen day). */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'scheduling', write: true });
  return Response.json(await createOpenShifts(tdb, org, user, await req.json().catch(() => null)), { status: 201 });
});
