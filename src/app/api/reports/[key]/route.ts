import { requireApiContext, withApi } from '@/lib/tenant';
import { toCsv } from '@/lib/csv';
import { runReport } from '@/lib/reports-server';
import { tableCsv } from '@/lib/reports';

export const dynamic = 'force-dynamic';

/** Run a report: ?from=&to=&branch= (JSON), or &format=csv to download. */
export const GET = withApi(async (req: Request, { params }: { params: { key: string } }) => {
  const { org, role } = await requireApiContext({ minRole: 'RECRUITER' });
  const q = new URL(req.url).searchParams;
  const t = await runReport(org, role, params.key, { from: q.get('from'), to: q.get('to'), branch: q.get('branch') });
  if (q.get('format') === 'csv') return new Response(toCsv(tableCsv(t)), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${params.key}-${q.get('from')}-to-${q.get('to')}.csv"`, 'Cache-Control': 'private, no-store' } });
  return Response.json(t);
});
