import { requireApiContext, withApi } from '@/lib/tenant';
import { exportAudit } from '@/lib/hr-audit-server';

/** The audit as a spreadsheet (CSV): every finding with the people listed, and every checklist answer. */
export const GET = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireApiContext({ minRole: 'ADMIN', feature: 'hrAudit' });
  const { name, csv } = await exportAudit(ctx, params.id, req);
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });
});
