import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { SendBody, loadInvoice, sendInvoice } from '@/lib/invoicing-server';

/** Email the invoice PDF to client contacts. */
export const POST = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'timesheets', write: true });
  const b = SendBody.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'Invalid input');
  const r = await sendInvoice(tdb, org, user, await loadInvoice(tdb, params.id), b.data);
  if (!r.sent.length) throw new HttpError(502, 'The email couldn’t be sent. Check the contact’s email address and try again.');
  return Response.json(r);
});
