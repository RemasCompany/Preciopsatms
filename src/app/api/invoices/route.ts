import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { CreateBody, createInvoice } from '@/lib/invoicing-server';

/** Create an invoice from a client's approved, not-yet-invoiced hours in a period. */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'timesheets', write: true });
  const b = CreateBody.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'Invalid input');
  const inv = await createInvoice(tdb, org, user, b.data);
  return Response.json({ id: inv.id, number: inv.number }, { status: 201 });
});
