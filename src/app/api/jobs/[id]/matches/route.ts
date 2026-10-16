import { requireApiContext, withApi } from '@/lib/tenant';
import { rankForJob } from '@/lib/match-server';

/** Candidates ranked for a job: everyone in its pipeline, plus the best of the talent pool who aren't in it yet. */
export const GET = withApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const { tdb } = await requireApiContext({ minRole: 'RECRUITER', feature: 'ats' });
  return Response.json(await rankForJob(tdb, params.id, { pool: true, limit: 15 }));
});
