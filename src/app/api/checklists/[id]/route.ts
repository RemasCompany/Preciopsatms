import { requireApiContext, withApi } from '@/lib/tenant';
import { cancelChecklist } from '@/lib/checklists-server';

/** Cancel a checklist the worker hasn't filled out. */
export const DELETE = withApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const { org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'credentials', write: true });
  await cancelChecklist(org, user, params.id);
  return Response.json({ ok: true });
});
