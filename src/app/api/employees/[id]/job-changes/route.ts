import { requireApiContext, withApi } from '@/lib/tenant';
import { propose } from '@/lib/job-changes';

/** Propose a promotion, demotion, lateral move or pay change. HR's are approved at once; a manager's go to HR unless approval is off. */
export const POST = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireApiContext({ minRole: 'RECRUITER', feature: 'people', write: true });
  return Response.json(await propose(ctx, params.id, await req.json().catch(() => null)), { status: 201 });
});
