import { HttpError, withApi } from '@/lib/tenant';
import { invoiceForToken } from '@/lib/online-payments';
import { invoicePdf, loadInvoice } from '@/lib/invoicing-server';

export const dynamic = 'force-dynamic';

/** Public: the invoice PDF behind a payment link. */
export const GET = withApi(async (_req: Request, { params }: { params: { token: string } }) => {
  const found = await invoiceForToken(params.token);
  if (!found || found.inv.status === 'VOID') throw new HttpError(404, 'That invoice wasn’t found.');
  const inv = await loadInvoice(found.tdb, found.inv.id);
  return new Response(Buffer.from(await invoicePdf(found.org, inv)), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${inv.number}.pdf"`, 'Cache-Control': 'private, no-store' } });
});
