import { requireApiContext, withApi } from '@/lib/tenant';
import { removePremium } from '@/lib/differentials-server';

export const DELETE = withApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireApiContext({ minRole: 'RECRUITER', feature: 'timesheets', write: true });
  await removePremium(ctx, params.id);
  return Response.json({ ok: true });
});
