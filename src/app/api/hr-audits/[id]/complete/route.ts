import { requireApiContext, withApi } from '@/lib/tenant';
import { completeAudit } from '@/lib/hr-audit-server';

/** Completes the audit: the findings and score are frozen as the record of this audit. */
export const POST = withApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireApiContext({ minRole: 'ADMIN', feature: 'hrAudit', write: true });
  return Response.json(await completeAudit(ctx, params.id));
});
