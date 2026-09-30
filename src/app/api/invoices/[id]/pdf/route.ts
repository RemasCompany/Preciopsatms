import { requireApiContext, withApi } from '@/lib/tenant';
import { invoicePdf, loadInvoice } from '@/lib/invoicing-server';

export const dynamic = 'force-dynamic';

export const GET = withApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org } = await requireApiContext({ minRole: 'ADMIN', feature: 'timesheets' });
  const inv = await loadInvoice(tdb, params.id);
  const pdf = await invoicePdf(org, inv);
  return new Response(Buffer.from(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${inv.number}${inv.status === 'VOID' ? '-VOID' : ''}.pdf"`, 'Cache-Control': 'private, no-store' } });
});
