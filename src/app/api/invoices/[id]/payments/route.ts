import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { PaymentBody, loadInvoice, recordPayment } from '@/lib/invoicing-server';

/** Record money received against an invoice (partial payments allowed, never more than the balance). */
export const POST = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'timesheets', write: true });
  const b = PaymentBody.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'Invalid input');
  const p = await recordPayment(tdb, org, user, await loadInvoice(tdb, params.id), b.data);
  return Response.json({ id: p.id }, { status: 201 });
});
