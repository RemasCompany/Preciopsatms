import { requireApiContext, withApi } from '@/lib/tenant';
import { requestLeave } from '@/lib/leave';

/** Ask for time off on an employee's behalf (HR and managers: recruiter role and up). */
export const POST = withApi(async (req: Request) => {
  const ctx = await requireApiContext({ minRole: 'RECRUITER', feature: 'timeoff', write: true });
  return Response.json(await requestLeave(ctx, await req.json().catch(() => null)), { status: 201 });
});
