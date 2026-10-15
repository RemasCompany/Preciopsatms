import { requireApiContext, withApi } from '@/lib/tenant';
import { updateTask } from '@/lib/offboarding';

/** Tick off a task, or add a note (e.g. exit interview notes, equipment returned). */
export const PATCH = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireApiContext({ minRole: 'RECRUITER', feature: 'people', write: true });
  return Response.json(await updateTask(ctx, params.id, await req.json().catch(() => null)));
});
