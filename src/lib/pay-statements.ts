import type { Organization } from '@prisma/client';
import type { TenantDb } from './tenant';
import { loadRun } from './payroll-run-server';
import { ADJUSTMENTS, EXPORT_FORMATS, byWorker, cents, dollars, totals, isExportFormat } from './payroll-run';
import { renderPaySummariesPdf } from './pdf';

const short = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmt = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Pay summaries for a run: one page per worker, or just one worker's. */
export async function statementsPdf(org: Organization, tdb: TenantDb, runId: string, only?: string | null) {
  const { run, items, meta } = await loadRun(tdb, runId);
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
          ...(i.leaveHours ? [{ label: `Paid time off (wk ending ${short(i.weekEnding)})`, hours: i.leaveHours, rate: i.payRate, amount: i.leavePay ?? 0 }] : []),
        ]),
        adjustments: g.flatMap((i) => i.adjustments.map((a) => ({ label: `${ADJUSTMENTS[a.kind].label}: ${a.description}`, amount: dollars(cents(a.amount)), kind: a.kind === 'REIMBURSEMENT' ? 'reimbursement' as const : a.kind === 'DEDUCTION' ? 'deduction' as const : 'earning' as const }))),
        gross: dollars(t.gross), reimbursements: dollars(t.reimbursements), deductions: dollars(t.deductions),
      };
    }),
  });
  return { pdf, run };
}
