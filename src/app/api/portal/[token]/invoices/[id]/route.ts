import { HttpError, withApi } from '@/lib/tenant';
import { resolvePortal } from '@/lib/portal-server';
import { invoicePdf, loadInvoice } from '@/lib/invoicing-server';

export const dynamic = 'force-dynamic';

/** Public: an invoice PDF, only if it belongs to the contact's own client. */
export const GET = withApi(async (_req: Request, { params }: { params: { token: string; id: string } }) => {
  const p = await resolvePortal(params.token);
  if (!p) throw new HttpError(404, 'This link has expired or was turned off.');
  const inv = await loadInvoice(p.tdb, params.id).catch(() => null);
  if (!inv || inv.clientId !== p.client.id || inv.status === 'VOID') throw new HttpError(404, 'That invoice wasn’t found.');
  return new Response(Buffer.from(await invoicePdf(p.org, inv)), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${inv.number}.pdf"`, 'Cache-Control': 'private, no-store' } });
});
