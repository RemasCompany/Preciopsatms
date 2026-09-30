import Link from 'next/link';
import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { localDate } from '@/lib/timeclock';
import { BUCKETS, aging, daysOverdue, dso, toCents, usd } from '@/lib/invoicing';
import { balanceCents } from '@/lib/invoicing-server';
import { weekEnding, ymd, addWeeks } from '@/lib/weeks';
import { NewInvoice } from '@/components/Invoices';
import { SyncButton } from '@/components/Accounting';
import { PROVIDERS, type Provider } from '@/lib/accounting';
import Gate from '@/components/Gate';

export const dynamic = 'force-dynamic';
const TABS = { open: 'Open', overdue: 'Overdue', paid: 'Paid', void: 'Void', all: 'All' } as const;
type Tab = keyof typeof TABS;
const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export default async function Invoices({ searchParams }: { searchParams: { tab?: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'timesheets')) return <Gate title="Invoices" feature="Client invoicing and receivables" />;
  if (ctx.role !== 'OWNER' && ctx.role !== 'ADMIN') return (<><h1>Invoices</h1><p className="card">Only owners and admins can see invoices and receivables.</p></>);
  const tab: Tab = (searchParams.tab as Tab) in TABS ? (searchParams.tab as Tab) : 'open';
  const today = localDate(new Date(), ctx.org.timezone), todayD = new Date(`${today}T00:00:00Z`);
  const since90 = new Date(todayD.getTime() - 90 * 864e5), since30 = new Date(todayD.getTime() - 30 * 864e5);

  const [all, clients, recentTs, payments30, conn] = await Promise.all([
    ctx.tdb.invoice.findMany({ include: { client: { select: { name: true } } }, orderBy: [{ issueDate: 'desc' }, { number: 'desc' }], take: 1000 }),
    ctx.tdb.client.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ctx.tdb.timesheet.findMany({ where: { status: { in: ['APPROVED', 'PAID'] }, weekEnding: { gte: addWeeks(weekEnding(), -26) } }, select: { id: true, weekEnding: true, regularHours: true, overtimeHours: true, application: { select: { job: { select: { clientId: true } } } } } }),
    ctx.tdb.payment.aggregate({ where: { receivedOn: { gte: since30 } }, _sum: { amount: true } }),
    ctx.tdb.accountingConnection.findFirst({ orderBy: { connectedAt: 'desc' } }),
  ]);
  const books = conn ? PROVIDERS[conn.provider as Provider].name : null;
  const unsynced = all.filter((i) => i.status !== 'VOID' && !i.syncedAt).length;
  const billedIds = new Set((await ctx.tdb.invoiceLine.findMany({ where: { timesheetId: { in: recentTs.map((t) => t.id) }, invoice: { status: { not: 'VOID' } } }, select: { timesheetId: true } })).map((l) => l.timesheetId));
  const unbilledWeeks = new Map<string, Set<string>>();
  for (const t of recentTs) {
    const c = t.application.job.clientId;
    if (!c || billedIds.has(t.id) || Number(t.regularHours) + Number(t.overtimeHours) === 0) continue;
    unbilledWeeks.set(c, (unbilledWeeks.get(c) ?? new Set()).add(ymd(t.weekEnding)));
  }

  const open = all.filter((i) => ['DRAFT', 'SENT', 'PARTIAL'].includes(i.status) && balanceCents(i) > 0);
  const { rows, totals } = aging(open.map((i) => ({ clientId: i.clientId, client: i.client.name, dueDate: ymd(i.dueDate), balanceCents: balanceCents(i) })), today);
  const overdue = open.filter((i) => daysOverdue(ymd(i.dueDate), today) > 0);
  const billed90 = all.filter((i) => i.status !== 'VOID' && i.issueDate >= since90).reduce((s, i) => s + toCents(i.total), 0);
  const d = dso(totals.total, billed90);
  const shown = tab === 'open' ? open : tab === 'overdue' ? overdue : tab === 'paid' ? all.filter((i) => i.status === 'PAID') : tab === 'void' ? all.filter((i) => i.status === 'VOID') : all;
  const lastWeek = weekEnding(new Date(Date.now() - 7 * 864e5));

  return (
    <>
      <h1>Invoices</h1>
      <p className="lede">Bill clients from approved hours, email the invoice, record payments as they come in, and see who owes what and for how long.</p>
      <div className="kpis" style={{ margin: '16px 0' }}>
        <div className="kpi"><b>{usd(totals.total)}</b><span>Open receivables</span><span className="sub">{open.length} invoice{open.length === 1 ? '' : 's'}</span></div>
        <div className="kpi"><b className={overdue.length ? 'warnnum' : undefined}>{usd(overdue.reduce((s, i) => s + balanceCents(i), 0))}</b><span>Past due</span><span className="sub">{overdue.length} invoice{overdue.length === 1 ? '' : 's'}</span></div>
        <div className="kpi"><b>{d ?? '—'}</b><span>Days sales outstanding</span><span className="sub">last 90 days</span></div>
        <div className="kpi"><b>{usd(toCents(payments30._sum.amount ?? 0))}</b><span>Collected</span><span className="sub">last 30 days</span></div>
        <div className="kpi"><b className={unbilledWeeks.size ? 'warnnum' : undefined}>{unbilledWeeks.size}</b><span>Clients with unbilled hours</span></div>
      </div>

      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Receivables aging</h2>
          {rows.length > 0 && <a className="btn ghost sm" href="/api/invoices/aging">Download CSV</a>}
        </div>
        {rows.length ? (
          <div className="tablewrap"><table><thead><tr><th>Client</th>{BUCKETS.map((b) => <th key={b.key}>{b.label}</th>)}<th>Total</th></tr></thead><tbody>
            {rows.map((r) => <tr key={r.clientId}><td><b>{r.client}</b>{r.oldest > 0 && <div className="muted">oldest {r.oldest} days past due</div>}</td>{BUCKETS.map((b) => <td key={b.key} className={b.key !== 'current' && r[b.key] ? 'warnnum' : undefined}>{r[b.key] ? usd(r[b.key]) : '—'}</td>)}<td><b>{usd(r.total)}</b></td></tr>)}
            <tr><td><b>Total</b></td>{BUCKETS.map((b) => <td key={b.key}><b>{totals[b.key] ? usd(totals[b.key]) : '—'}</b></td>)}<td><b>{usd(totals.total)}</b></td></tr>
          </tbody></table></div>
        ) : <p className="muted" style={{ margin: '8px 0 0' }}>Nothing owed right now.</p>}
      </section>

      <div className="bar" style={{ marginTop: 16 }}>
        <nav className="row" aria-label="Invoice status">{(Object.keys(TABS) as Tab[]).map((t) => <Link key={t} className={`btn ${t === tab ? '' : 'ghost'} sm`} href={`/app/invoices?tab=${t}`} aria-current={t === tab ? 'page' : undefined}>{TABS[t]}</Link>)}</nav>
        <span className="grow" />
        {canEdit(ctx) && books && unsynced > 0 && <SyncButton provider={books} label={`Send ${unsynced} to ${books}`} />}
        {canEdit(ctx) && <NewInvoice clients={clients.map((c) => ({ ...c, unbilled: unbilledWeeks.get(c.id)?.size ?? 0 }))} defaultFrom={ymd(addWeeks(lastWeek, -3))} defaultTo={ymd(lastWeek)} />}
      </div>
      {shown.length ? (
        <div className="tablewrap"><table><thead><tr><th>Invoice</th><th>Client</th><th>Issued</th><th>Due</th><th>Total</th><th>Balance</th><th>Status</th></tr></thead><tbody>
          {shown.map((i) => {
            const od = ['DRAFT', 'SENT', 'PARTIAL'].includes(i.status) ? daysOverdue(ymd(i.dueDate), today) : 0;
            return (
              <tr key={i.id}>
                <td><Link href={`/app/invoices/${i.id}`}><b>{i.number}</b></Link>{books && i.status !== 'VOID' && (i.syncError || i.syncedAt) && <div className={i.syncError ? 'warn' : 'muted'} style={{ fontSize: 12.5 }}>{i.syncError ? `Not in ${books}` : `In ${books}`}</div>}</td>
                <td>{i.client.name}</td><td>{fmt(i.issueDate)}</td>
                <td>{fmt(i.dueDate)}{od > 0 && <div className="warn">{od} days past due</div>}</td>
                <td>{usd(toCents(i.total))}</td><td>{i.status === 'VOID' ? '—' : usd(balanceCents(i))}</td>
                <td><span className={`pill ${i.status === 'PAID' ? 'g' : i.status === 'VOID' ? '' : od > 0 ? 'r' : 'a'}`}>{i.status === 'PARTIAL' ? 'Partly paid' : i.status[0] + i.status.slice(1).toLowerCase()}</span></td>
              </tr>
            );
          })}
        </tbody></table></div>
      ) : <div className="card empty"><b>{tab === 'all' ? 'No invoices yet' : `No ${TABS[tab].toLowerCase()} invoices`}</b>{tab === 'all' || tab === 'open' ? 'Approve a week of timesheets, then create an invoice here or from the Timesheets page.' : ''}</div>}
    </>
  );
}
