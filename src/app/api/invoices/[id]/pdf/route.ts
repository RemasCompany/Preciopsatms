import { requireApiContext, withApi } from '@/lib/tenant';
import { invoicePdf, loadInvoice } from '@/lib/invoicing-server';

export const dynamic = 'force-dynamic';

export const GET = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org } = await requireApiContext({ minRole: 'ADMIN', feature: 'invoicing' });
  const inv = await loadInvoice(tdb, params.id);
  const pdf = await invoicePdf(org, inv);
  return new Response(Buffer.from(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${new URL(req.url).searchParams.has('view') ? 'inline' : 'attachment'}; filename="${inv.number}${inv.status === 'VOID' ? '-VOID' : ''}.pdf"`, 'Cache-Control': 'private, no-store' } });
});
