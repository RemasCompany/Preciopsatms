import { requireApiContext, withApi, logActivity } from '@/lib/tenant';
import { loadRun } from '@/lib/payroll-run-server';
import { ADJUSTMENTS, EXPORT_FORMATS, byWorker, cents, dollars, totals, isExportFormat } from '@/lib/payroll-run';
import { renderPaySummariesPdf } from '@/lib/pdf';

export const dynamic = 'force-dynamic';
const short = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmt = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Pay summaries (one page per worker) for a run, or for one worker with ?worker=candidateId. */
export const GET = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'payrollRuns' });
  const only = new URL(req.url).searchParams.get('worker');
  const { run, items, meta } = await loadRun(tdb, params.id);
  const groups = byWorker(items).filter((g) => !only || g[0].candidateId === only);
  const provider = isExportFormat(org.payrollProvider) && org.payrollProvider !== 'csv' ? EXPORT_FORMATS[org.payrollProvider].split(' (')[0] : null;
  const pdf = await renderPaySummariesPdf({
    company: org.name, city: org.city, run: `${run.number}${run.status === 'DRAFT' ? ' (DRAFT)' : run.status === 'VOID' ? ' (VOID)' : ''}`,
    period: `${fmt(meta.periodStart)} - ${fmt(meta.periodEnd)}`, payDate: fmt(meta.payDate), provider,
    workers: groups.map((g) => {
      const t = totals(g);
      return {
        name: g[0].workerName, payrollId: g[0].payrollId,
        lines: g.flatMap((i) => [
          ...(i.regularHours ? [{ label: `Regular (wk ending ${short(i.weekEnding)}) - ${i.position}`, hours: i.regularHours, rate: i.payRate, amount: i.regularPay }] : []),
          ...(i.overtimeHours ? [{ label: `Overtime 1.5x (wk ending ${short(i.weekEnding)}) - ${i.position}`, hours: i.overtimeHours, rate: i.payRate * 1.5, amount: i.overtimePay }] : []),
        ]),
        adjustments: g.flatMap((i) => i.adjustments.map((a) => ({ label: `${ADJUSTMENTS[a.kind].label}: ${a.description}`, amount: dollars(cents(a.amount)), kind: a.kind === 'REIMBURSEMENT' ? 'reimbursement' as const : a.kind === 'DEDUCTION' ? 'deduction' as const : 'earning' as const }))),
        gross: dollars(t.gross), reimbursements: dollars(t.reimbursements), deductions: dollars(t.deductions),
      };
    }),
  });
  await logActivity(org.id, `Downloaded pay summaries for ${run.number}`, user.id);
  return new Response(Buffer.from(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${run.number}-pay-summaries.pdf"`, 'Cache-Control': 'private, no-store' } });
});
