import Link from 'next/link';
import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { weekEnding, addWeeks } from '@/lib/weeks';
import { totals, type RunItem } from '@/lib/payroll-run';
import { NewPayrollRun, PayrollSettings } from '@/components/PayrollRun';
import Gate from '@/components/Gate';

export const dynamic = 'force-dynamic';
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const money = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const PILL = { DRAFT: 'a', APPROVED: '', PAID: 'g', VOID: 'r' } as const;
const LABEL = { DRAFT: 'Draft', APPROVED: 'Approved — ready to export', PAID: 'Paid', VOID: 'Void' } as const;

export default async function Payroll() {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'payrollRuns')) return <Gate title="Payroll runs" feature="Payroll runs (Enterprise)" />;
  if (ctx.role !== 'OWNER' && ctx.role !== 'ADMIN') return <div className="card empty"><b>Payroll is limited to admins</b>Ask an owner or admin on your team for access.</div>;
  const runs = await ctx.tdb.payrollRun.findMany({ include: { items: { include: { adjustments: true } } }, orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }], take: 100 });
  const lastWeek = ymd(addWeeks(weekEnding(), -1));
  const lastEnd = runs.find((r) => r.status !== 'VOID')?.periodEnd;
  return (
    <>
      <h1>Payroll runs</h1>
      <p className="lede">Turn approved timesheets into a pay run: review hours, add bonuses, reimbursements and deductions, approve, and export the file your payroll provider imports. Taxes, direct deposit and filings stay with your provider.</p>
      {canEdit(ctx) && <NewPayrollRun defaultEnd={lastEnd ? ymd(addWeeks(lastEnd, 1)) : lastWeek} />}
      {runs.length ? (
        <div className="tablewrap"><table>
          <thead><tr><th>Run</th><th>Pay period</th><th>Pay date</th><th>Workers</th><th>Hours</th><th>Gross pay</th><th>Status</th></tr></thead>
          <tbody>{runs.map((r) => {
            const items: RunItem[] = r.items.map((i) => ({ ...i, weekEnding: ymd(i.weekEnding), regularHours: Number(i.regularHours), overtimeHours: Number(i.overtimeHours), payRate: Number(i.payRate), billRate: Number(i.billRate), regularPay: Number(i.regularPay), overtimePay: Number(i.overtimePay), adjustments: i.adjustments.map((a) => ({ ...a, amount: Number(a.amount) })) }));
            const t = totals(items);
            return (
              <tr key={r.id}>
                <td><Link href={`/app/payroll/${r.id}`}><b>{r.number}</b></Link><div className="muted">{r.frequency === 'BIWEEKLY' ? 'Every two weeks' : 'Weekly'}</div></td>
                <td>{fmt(r.periodStart)} – {fmt(r.periodEnd)}</td><td>{fmt(r.payDate)}</td>
                <td>{new Set(items.map((i) => i.candidateId)).size}</td><td>{+t.hours.toFixed(2)}</td><td>{money(t.gross)}</td>
                <td><span className={`pill ${PILL[r.status]}`}>{LABEL[r.status]}</span></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      ) : <div className="card empty"><b>No payroll runs yet</b>Approve timesheets on Timesheets & payroll, then start a run for the pay period above.</div>}
      {canEdit(ctx) && <PayrollSettings provider={ctx.org.payrollProvider} companyCode={ctx.org.payrollCompanyCode} />}
    </>
  );
}
