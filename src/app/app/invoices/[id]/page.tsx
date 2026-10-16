import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePageContext, canEdit, HttpError } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { localDate } from '@/lib/timeclock';
import { daysOverdue, toCents, usd } from '@/lib/invoicing';
import { balanceCents, invoiceSummary, loadInvoice, lockedReason } from '@/lib/invoicing-server';
import { ITEM_KINDS, type ItemKind } from '@/lib/invoicing';
import { ymd } from '@/lib/weeks';
import { EditDraft, InvoiceActions } from '@/components/Invoices';
import { SyncButton } from '@/components/Accounting';
import { PROVIDERS, type Provider } from '@/lib/accounting';
import Gate from '@/components/Gate';

export const dynamic = 'force-dynamic';
const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export default async function InvoicePage({ params }: { params: { id: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'invoicing')) return <Gate title="Invoices" feature="Client invoicing and receivables" employer={ctx.org.kind === 'EMPLOYER'} />;
  if (ctx.role !== 'OWNER' && ctx.role !== 'ADMIN') return (<><h1>Invoice</h1><p className="card">Only owners and admins can see invoices.</p></>);
  const inv = await loadInvoice(ctx.tdb, params.id).catch((e) => { if (e instanceof HttpError) notFound(); throw e; });
  const conn = await ctx.tdb.accountingConnection.findFirst({ orderBy: { connectedAt: 'desc' } });
  const books = conn ? PROVIDERS[conn.provider as Provider].name : null;
  const bal = balanceCents(inv), today = localDate(new Date(), ctx.org.timezone);
  const od = ['DRAFT', 'SENT', 'PARTIAL'].includes(inv.status) ? daysOverdue(ymd(inv.dueDate), today) : 0;
  const status = inv.status === 'PARTIAL' ? 'Partly paid' : inv.status === 'DRAFT' && !inv.sentAt ? 'Draft — not sent' : inv.status[0] + inv.status.slice(1).toLowerCase();
  const t = invoiceSummary(inv), locked = lockedReason(inv);
  const hours = inv.lines.filter((l) => l.kind === 'hours'), items = inv.lines.filter((l) => l.kind !== 'hours');
  const org = ctx.org;
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
      <section className="card">
        <div className="invmeta">
          <div><span>Bill to</span><b>{inv.client.name}</b>{inv.billToName && <span>Attn: {inv.billToName}</span>}{inv.billToAddress ? <span className="invaddr">{inv.billToAddress}</span> : <span className="warn" style={{ fontSize: 12.5 }}>No billing address</span>}</div>
          <div><span>PO number</span><b>{inv.poNumber || '—'}</b><span>Terms</span><b>{inv.terms}</b></div>
          <div><span>Services</span><b>{t.workers} worker{t.workers === 1 ? '' : 's'}</b><span>{t.regular.toFixed(2)} regular · {t.overtime.toFixed(2)} overtime hrs</span></div>
          <div><span>From</span><b>{org.name}</b>{org.billingAddress ? <span className="invaddr">{org.billingAddress}</span> : <span className="warn" style={{ fontSize: 12.5 }}>Add your billing address in Settings</span>}{!org.remitInstructions && <span className="warn" style={{ fontSize: 12.5 }}>No payment instructions yet</span>}</div>
        </div>
        {(!org.billingAddress || !org.remitInstructions) && canEdit(ctx) && <p className="muted" style={{ margin: 0, fontSize: 13 }}><Link href="/app/settings">Add your billing address and how to pay</Link> — they print on every invoice.</p>}
      </section>
      {books && inv.status !== 'VOID' && (
        <div className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
          <span className={inv.syncError ? 'warn' : 'muted'}>{inv.syncError ? `Not sent to ${books}: ${inv.syncError}` : inv.syncedAt ? `In ${books} (updated ${inv.syncedAt.toLocaleDateString('en-US')})` : `Not in ${books} yet.`}</span>
          {canEdit(ctx) && <SyncButton provider={books} invoiceIds={[inv.id]} label={inv.syncedAt ? 'Send new payments' : `Send to ${books}`} />}
        </div>
      )}
      {inv.sentAt && <p className="muted">Emailed {inv.sentAt.toLocaleString('en-US', { timeZone: ctx.org.timezone, dateStyle: 'medium', timeStyle: 'short' })} to {inv.sentTo}.</p>}
      {canEdit(ctx) && !locked && (
        <div className="row" style={{ marginBottom: 8 }}>
          <EditDraft id={inv.id} number={inv.number} laborCents={t.labor}
            contacts={inv.client.contacts.map((c) => ({ id: c.id, name: c.name, title: c.title }))}
            initial={{ poNumber: inv.poNumber ?? '', billToName: inv.billToName ?? '', billToAddress: inv.billToAddress ?? '', notes: inv.notes ?? '', taxRatePct: String(Number(inv.taxRatePct)),
              items: items.map((l) => ({ kind: l.kind as ItemKind, description: l.description, quantity: String(Number(l.quantity ?? 1)), rate: String(Number(l.rate)) })) }} />
          <span className="muted" style={{ fontSize: 13, alignSelf: 'center' }}>Draft: change details and items until you email it.</span>
        </div>
      )}
      {canEdit(ctx) ? (
        <InvoiceActions billingEmail={inv.client.billingEmail} id={inv.id} number={inv.number} status={inv.status} balance={bal / 100} sentTo={inv.sentTo}
          contacts={inv.client.contacts.map((c) => ({ id: c.id, name: c.name, email: c.email }))}
          payments={inv.payments.map((p) => ({ id: p.id, amount: Number(p.amount), receivedOn: ymd(p.receivedOn), method: p.method, reference: p.reference }))} />
      ) : <a className="btn ghost" href={`/api/invoices/${inv.id}/pdf`}>Download PDF</a>}
      <h2 style={{ fontSize: 18, margin: '22px 0 8px' }}>Services</h2>
      <div className="tablewrap"><table><thead><tr><th>Worker</th><th>Position</th><th>Week ending</th><th>Regular</th><th>Overtime (1.5x)</th><th>Bill rate</th><th>Amount</th></tr></thead><tbody>
        {hours.map((l) => <tr key={l.id}><td>{l.worker}{l.approvedBy && <div className="muted" style={{ fontSize: 12 }}>✓ {l.approvedBy}</div>}</td><td>{l.description}</td><td>{l.weekEnding ? fmt(l.weekEnding) : '—'}</td><td>{Number(l.regularHours)}</td><td>{Number(l.overtimeHours)}</td><td>{usd(toCents(l.rate))}/hr</td><td>{usd(toCents(l.amount))}</td></tr>)}
        <tr><td colSpan={6}><b>Services total</b></td><td><b>{usd(t.labor)}</b></td></tr>
      </tbody></table></div>
      {items.length > 0 && <>
        <h2 style={{ fontSize: 18, margin: '22px 0 8px' }}>Additional items</h2>
        <div className="tablewrap"><table><thead><tr><th>Kind</th><th>Description</th><th>Qty</th><th>Each</th><th>Amount</th></tr></thead><tbody>
          {items.map((l) => <tr key={l.id}><td>{ITEM_KINDS[l.kind as ItemKind] ?? l.kind}</td><td>{l.description}</td><td>{Number(l.quantity ?? 1)}</td><td>{usd(toCents(l.rate))}</td><td className={Number(l.amount) < 0 ? 'warnnum' : undefined}>{usd(toCents(l.amount))}</td></tr>)}
        </tbody></table></div>
      </>}
      <div className="invtotals" style={{ margin: '16px 0 0 auto' }}>
        <span>Services</span><span>{usd(t.labor)}</span>
        {t.extras > 0 && <><span>Additional items</span><span>{usd(t.extras)}</span></>}
        {t.discounts > 0 && <><span>Discounts and credits</span><span>-{usd(t.discounts)}</span></>}
        <span>Subtotal</span><span>{usd(t.subtotal)}</span>
        {t.tax > 0 && <><span>Sales tax ({t.taxRatePct}%)</span><span>{usd(t.tax)}</span></>}
        <span className="big">Total</span><span className="big">{usd(t.total)}</span>
        {t.paid > 0 && <><span>Payments received</span><span>-{usd(t.paid)}</span><span className="big">Balance due</span><span className="big">{usd(t.balance)}</span></>}
      </div>
      {inv.notes && <p className="muted">Note to client: {inv.notes}</p>}
    </>
  );
}
