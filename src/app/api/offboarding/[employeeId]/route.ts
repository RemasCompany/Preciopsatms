import { requireApiContext, withApi } from '@/lib/tenant';
import { addTask } from '@/lib/offboarding';

/** Add a task to someone's offboarding checklist. */
export const POST = withApi(async (req: Request, { params }: { params: { employeeId: string } }) => {
  const ctx = await requireApiContext({ minRole: 'RECRUITER', feature: 'people', write: true });
  return Response.json(await addTask(ctx, params.employeeId, await req.json().catch(() => null)), { status: 201 });
});
