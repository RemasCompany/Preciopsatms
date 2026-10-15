import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { saveGoal } from '@/lib/reviews';

export const POST = withApi(async (req: Request) => {
  const ctx = await requireApiContext({ minRole: 'RECRUITER', feature: 'reviews', write: true });
  const body = await req.json().catch(() => null);
  if (typeof body?.employeeId !== 'string') throw new HttpError(400, 'Choose an employee.');
  return Response.json(await saveGoal(ctx, body.employeeId, null, body), { status: 201 });
});
