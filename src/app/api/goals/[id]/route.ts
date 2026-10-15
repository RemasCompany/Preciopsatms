import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { saveGoal } from '@/lib/reviews';

export const PATCH = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireApiContext({ minRole: 'RECRUITER', feature: 'reviews', write: true });
  const g = await ctx.tdb.goal.findFirst({ where: { id: params.id } });
  if (!g) throw new HttpError(404, 'That goal was deleted.');
  return Response.json(await saveGoal(ctx, g.employeeId, g.id, await req.json().catch(() => null)));
});
