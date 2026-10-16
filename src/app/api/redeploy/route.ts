import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { endingAssignments, redeployAction } from '@/lib/redeploy';

/** Assignments ending in the next two weeks (or ended in the last month) with no next one, and the jobs each person fits. */
export const GET = withApi(async () => {
  const { tdb, org } = await requireApiContext({ minRole: 'RECRUITER', feature: 'ats' });
  if (org.kind === 'EMPLOYER') throw new HttpError(403, 'Redeployment is for staffing agencies.');
  return Response.json(await endingAssignments(tdb, org));
});

/** { action: 'endDate' | 'handled' | 'submit' | 'text', applicationId, … } */
export const POST = withApi(async (req: Request) => {
  const ctx = await requireApiContext({ minRole: 'RECRUITER', feature: 'ats', write: true });
  return Response.json(await redeployAction(ctx, await req.json().catch(() => null)));
});
