import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { staffTaskComment } from '@/lib/employee-hub';

/** Post an update on a task. If it's assigned to an employee, they're told. */
export const POST = withApi(async (req: Request, { params }: { params: { kind: string; id: string } }) => {
  if (params.kind !== 'tasks') throw new HttpError(404, 'Not found');
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', write: true });
  return Response.json(await staffTaskComment(tdb, org, user, params.id, await req.json().catch(() => null)));
});
