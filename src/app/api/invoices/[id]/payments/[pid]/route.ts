import { requireApiContext, withApi } from '@/lib/tenant';
import { deletePayment } from '@/lib/invoicing-server';

/** Remove a payment recorded by mistake. */
export const DELETE = withApi(async (_req: Request, { params }: { params: { id: string; pid: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'timesheets', write: true });
  await deletePayment(tdb, org, user, params.id, params.pid);
  return Response.json({ ok: true });
});
