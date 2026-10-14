import { requireApiContext, withApi } from '@/lib/tenant';
import { assign } from '@/lib/training-server';

/** Assign a course to workers and send each one their private link. */
export const POST = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'training', write: true });
  return Response.json(await assign(org, user, await req.json().catch(() => null)), { status: 201 });
});
