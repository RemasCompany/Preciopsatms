import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { loadRun } from '@/lib/payroll-run-server';
import { EXPORT_FORMATS, exportRun, isExportFormat } from '@/lib/payroll-run';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** The provider import file for an approved or paid run. */
export const GET = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'payrollRuns' });
  const f = new URL(req.url).searchParams.get('format') ?? org.payrollProvider ?? 'csv';
  if (!isExportFormat(f)) throw new HttpError(400, 'Choose an export format.');
  const { run, items, meta } = await loadRun(tdb, params.id);
  if (run.status !== 'APPROVED' && run.status !== 'PAID') throw new HttpError(409, 'Approve the run before exporting it.');
  const body = exportRun(f, meta, items, { companyCode: org.payrollCompanyCode });
  await logActivity(org.id, `Exported payroll run ${run.number} (${EXPORT_FORMATS[f]})`, user.id);
  await audit(org.id, user, 'payroll.export', `Exported payroll run ${run.number} (${EXPORT_FORMATS[f]})`, { targetType: 'payrollRun', targetId: run.id, req });
  return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${run.number}-${f}.csv"`, 'Cache-Control': 'private, no-store' } });
});
