import { requireApiContext, withApi } from '@/lib/tenant';
import { rankJobsFor } from '@/lib/match-server';

/** Open jobs ranked for a candidate (jobs they're already in are left out). */
export const GET = withApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const { tdb } = await requireApiContext({ minRole: 'RECRUITER', feature: 'ats' });
  return Response.json({ jobs: await rankJobsFor(tdb, params.id) });
});
