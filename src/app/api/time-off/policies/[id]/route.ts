import { requireApiContext, withApi } from '@/lib/tenant';
import { archivePolicy, savePolicy } from '@/lib/leave';

/** Edit a policy, or `{ archived: true|false }` to retire or restore it. */
export const PATCH = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireApiContext({ minRole: 'ADMIN', feature: 'timeoff', write: true });
  const body = await req.json().catch(() => null);
  if (body && typeof body.archived === 'boolean' && Object.keys(body).length === 1) { await archivePolicy(ctx, params.id, body.archived); return Response.json({ ok: true }); }
  return Response.json(await savePolicy(ctx, params.id, body));
});
