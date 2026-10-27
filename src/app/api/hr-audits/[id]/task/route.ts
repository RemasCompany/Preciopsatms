import { z } from 'zod';
import { requireApiContext, withApi } from '@/lib/tenant';
import { taskFromFinding } from '@/lib/hr-audit-server';

/** Adds a follow-up task for one finding. */
export const POST = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireApiContext({ minRole: 'ADMIN', feature: 'hrAudit', write: true });
  const { key } = z.object({ key: z.string().max(60) }).parse(await req.json());
  return Response.json({ id: await taskFromFinding(ctx, params.id, key) }, { status: 201 });
});
