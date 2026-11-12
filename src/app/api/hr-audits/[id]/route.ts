import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { getAudit, UpdateBody, updateAudit } from '@/lib/hr-audit-server';

type P = { params: { id: string } };

export const GET = withApi(async (_req: Request, { params }: P) => {
  const ctx = await requireApiContext({ minRole: 'ADMIN', feature: 'hrAudit' });
  return Response.json(await getAudit(ctx, params.id));
});

/** Answer a checklist item, mark an automatic check reviewed (with a note), or edit the audit notes. */
export const PATCH = withApi(async (req: Request, { params }: P) => {
  const ctx = await requireApiContext({ minRole: 'ADMIN', feature: 'hrAudit', write: true });
  const b = UpdateBody.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'Invalid input');
  return Response.json(await updateAudit(ctx, params.id, b.data));
});
