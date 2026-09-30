import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePageContext, canEdit, HttpError } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { localDate } from '@/lib/timeclock';
import { daysOverdue, toCents, usd } from '@/lib/invoicing';
import { balanceCents, loadInvoice } from '@/lib/invoicing-server';
import { ymd } from '@/lib/weeks';
import { InvoiceActions } from '@/components/Invoices';
import { SyncButton } from '@/components/Accounting';
import { PROVIDERS, type Provider } from '@/lib/accounting';
import Gate from '@/components/Gate';

export const dynamic = 'force-dynamic';
const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export default async function InvoicePage({ params }: { params: { id: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'timesheets')) return <Gate title="Invoices" feature="Client invoicing and receivables" />;
  if (ctx.role !== 'OWNER' && ctx.role !== 'ADMIN') return (<><h1>Invoice</h1><p className="card">Only owners and admins can see invoices.</p></>);
  const inv = await loadInvoice(ctx.tdb, params.id).catch((e) => { if (e instanceof HttpError) notFound(); throw e; });
  const conn = await ctx.tdb.accountingConnection.findFirst({ orderBy: { connectedAt: 'desc' } });
  const books = conn ? PROVIDERS[conn.provider as Provider].name : null;
  const bal = balanceCents(inv), today = localDate(new Date(), ctx.org.timezone);
  const od = ['DRAFT', 'SENT', 'PARTIAL'].includes(inv.status) ? daysOverdue(ymd(inv.dueDate), today) : 0;
  const status = inv.status === 'PARTIAL' ? 'Partly paid' : inv.status[0] + inv.status.slice(1).toLowerCase();
  return (
    <>
      <p className="muted" style={{ margin: 0 }}><Link href="/app/invoices">← Invoices</Link></p>
      <h1>{inv.number} <span className={`pill ${inv.status === 'PAID' ? 'g' : inv.status === 'VOID' ? '' : od > 0 ? 'r' : 'a'}`} style={{ fontSize: 14, verticalAlign: 'middle' }}>{status}</span></h1>
      <p className="lede">{inv.client.name} · {inv.terms} · for {fmt(inv.periodStart)} – {fmt(inv.periodEnd)}</p>
      {inv.status === 'VOID' && <p className="card banner error">Voided {inv.voidedAt ? fmt(inv.voidedAt) : ''}: {inv.voidReason}</p>}
      <div className="kpis" style={{ margin: '16px 0' }}>
        <div className="kpi"><b>{usd(toCents(inv.total))}</b><span>Total</span></div>
        <div className="kpi"><b>{usd(toCents(inv.amountPaid))}</b><span>Paid</span></div>
        <div className="kpi"><b className={od > 0 ? 'warnnum' : undefined}>{inv.status === 'VOID' ? '—' : usd(bal)}</b><span>Balance</span></div>
        <div className="kpi"><b className={od > 0 ? 'warnnum' : undefined}>{fmt(inv.dueDate)}</b><span>Due</span><span className="sub">{od > 0 ? `${od} days past due` : `issued ${fmt(inv.issueDate)}`}</span></div>
      </div>
      {books && inv.status !== 'VOID' && (
        <div className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
          <span className={inv.syncError ? 'warn' : 'muted'}>{inv.syncError ? `Not sent to ${books}: ${inv.syncError}` : inv.syncedAt ? `In ${books} (updated ${inv.syncedAt.toLocaleDateString('en-US')})` : `Not in ${books} yet.`}</span>
          {canEdit(ctx) && <SyncButton provider={books} invoiceIds={[inv.id]} label={inv.syncedAt ? 'Send new payments' : `Send to ${books}`} />}
        </div>
      )}
      {inv.sentAt && <p className="muted">Emailed {inv.sentAt.toLocaleString('en-US', { timeZone: ctx.org.timezone, dateStyle: 'medium', timeStyle: 'short' })} to {inv.sentTo}.</p>}
      {canEdit(ctx) ? (
        <InvoiceActions id={inv.id} number={inv.number} status={inv.status} balance={bal / 100} sentTo={inv.sentTo}
          contacts={inv.client.contacts.map((c) => ({ id: c.id, name: c.name, email: c.email }))}
          payments={inv.payments.map((p) => ({ id: p.id, amount: Number(p.amount), receivedOn: ymd(p.receivedOn), method: p.method, reference: p.reference }))} />
      ) : <a className="btn ghost" href={`/api/invoices/${inv.id}/pdf`}>Download PDF</a>}
      <div className="tablewrap" style={{ marginTop: 16 }}><table><thead><tr><th>Worker</th><th>Position</th><th>Week ending</th><th>Regular</th><th>Overtime (1.5x)</th><th>Bill rate</th><th>Amount</th></tr></thead><tbody>
        {inv.lines.map((l) => <tr key={l.id}><td>{l.worker}</td><td>{l.description}</td><td>{l.weekEnding ? fmt(l.weekEnding) : '—'}</td><td>{Number(l.regularHours)}</td><td>{Number(l.overtimeHours)}</td><td>{usd(toCents(l.rate))}/hr</td><td>{usd(toCents(l.amount))}</td></tr>)}
        <tr><td colSpan={6}><b>Total</b></td><td><b>{usd(toCents(inv.total))}</b></td></tr>
      </tbody></table></div>
      {inv.notes && <p className="muted">Note: {inv.notes}</p>}
    </>
  );
}
