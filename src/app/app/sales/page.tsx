import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { db } from '@/lib/db';
import { PERIODS, STALE_DAYS, isPeriod, monthKey, periodRange, salesMetrics, type SalesKpis } from '@/lib/sales-metrics';
import { OpenRecord } from '@/components/Records';
import WonChart from '@/components/WonChart';
import SalesTargets from '@/components/SalesTargets';
import Gate from '@/components/Gate';

const money = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
const pct = (n: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`);
const days = (n: number | null) => (n == null ? '—' : `${Math.round(n)} ${Math.round(n) === 1 ? 'day' : 'days'}`);

function Quota({ k }: { k: Pick<SalesKpis, 'attainment' | 'target'> }) {
  if (k.attainment == null) return <span className="muted">No target</span>;
  return (
    <span className="quota" role="img" aria-label={`${pct(k.attainment)} of ${money(k.target)} target`}>
      <span className="track"><span className="fill" style={{ width: `${Math.min(100, k.attainment * 100)}%` }} /></span>
      <small>{pct(k.attainment)}</small>
    </span>
  );
}

export default async function Sales({ searchParams }: { searchParams: { period?: string; rep?: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'crm')) return <Gate title="Sales metrics" feature="CRM" />;
  const { tdb, org, role } = ctx;
  const period = isPeriod(searchParams.period) ? searchParams.period : 'month';
  const { from, to } = periodRange(period);

  const members = await db.membership.findMany({ where: { organizationId: org.id }, select: { user: { select: { id: true, name: true, email: true } } } });
  const reps = members.map((m) => ({ id: m.user.id, label: m.user.name || m.user.email })).sort((a, b) => a.label.localeCompare(b.label));
  const rep = reps.some((r) => r.id === searchParams.rep) ? searchParams.rep! : null;

  const [deals, leads, messages, targets] = await Promise.all([
    tdb.deal.findMany({ include: { client: { select: { name: true } } } }),
    tdb.lead.findMany({ select: { ownerId: true, status: true, createdAt: true, convertedAt: true } }),
    tdb.message.findMany({ where: { relatedType: { in: ['lead', 'contact'] }, status: { notIn: ['failed', 'blocked_opt_out'] }, createdAt: { gte: from, lt: to } }, select: { sentById: true, createdAt: true } }),
    tdb.salesTarget.findMany({ select: { userId: true, month: true, amount: true } }),
  ]);
  const targetRows = targets.map((t) => ({ userId: t.userId, month: monthKey(t.month), amount: Number(t.amount) }));
  const m = salesMetrics({
    deals: deals.map((d) => ({ id: d.id, title: d.title, client: d.client?.name ?? null, value: d.value == null ? null : Number(d.value), stage: d.stage, ownerId: d.ownerId, createdAt: d.createdAt, closedAt: d.closedAt, stageChangedAt: d.stageChangedAt, closeDate: d.closeDate })),
    leads, messages, targets: targetRows, reps, from, to, rep,
  });
  const k = m.kpis;
  const repName = new Map(reps.map((r) => [r.id, r.label]));
  const isAdmin = role === 'OWNER' || role === 'ADMIN';
  const now = new Date();
  const targetMonths = [-1, 0, 1, 2].map((i) => monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1))));
  const top = Math.max(1, m.funnel[0].count);

  return (
    <>
      <h1>Sales metrics</h1>
      <p className="lede">How the sales team is doing: revenue won against target, win rate, pipeline and lead follow-through. Deals and leads count toward their owner.</p>

      <form className="bar" aria-label="Filters">
        <select name="period" defaultValue={period} aria-label="Period">
          {Object.entries(PERIODS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="rep" defaultValue={rep ?? ''} aria-label="Rep">
          <option value="">Whole team</option>
          {reps.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <button className="btn ghost">Show</button>
      </form>

      <div className="kpis">
        <div className="kpi"><b>{money(k.wonRevenue)}</b><span>Won revenue</span>{k.target != null && <span className="sub">{pct(k.attainment)} of {money(k.target)} target</span>}</div>
        <div className="kpi"><b>{k.wonCount}</b><span>Deals won</span><span className="sub">{k.lostCount} lost</span></div>
        <div className="kpi"><b>{pct(k.winRate)}</b><span>Win rate</span></div>
        <div className="kpi"><b>{money(k.avgDeal)}</b><span>Average deal</span></div>
        <div className="kpi"><b>{days(k.avgCycleDays)}</b><span>Average sales cycle</span></div>
        <div className="kpi"><b>{money(k.openPipeline)}</b><span>Open pipeline</span><span className="sub">{money(k.weighted)} weighted · {k.openCount} deals</span></div>
        <div className="kpi"><b>{k.newLeads}</b><span>New leads</span><span className="sub">{k.convertedLeads} converted</span></div>
        <div className="kpi"><b>{pct(k.leadConversion)}</b><span>Lead conversion</span></div>
        <div className="kpi"><b>{k.outreach}</b><span>Emails & texts to prospects</span></div>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>Won, lost, win rate and cycle count deals closed in the period. Pipeline is what’s open today. Lead conversion is the share of the period’s new leads that became clients.</p>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Won revenue by month</h2>
        <WonChart data={m.monthly} />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Leaderboard</h2>
        {m.board.length ? (
          <div className="tablewrap">
            <table>
              <thead><tr><th>Rep</th><th>Won</th><th>Quota</th><th>Deals won</th><th>Win rate</th><th>Weighted pipeline</th><th>New leads</th><th>Outreach</th></tr></thead>
              <tbody>{m.board.map((r) => (
                <tr key={r.id || 'none'}>
                  <td><b>{r.label}</b></td><td>{money(r.wonRevenue)}</td><td><Quota k={r} /></td><td>{r.wonCount}</td>
                  <td>{pct(r.winRate)}</td><td>{money(r.weighted)}</td><td>{r.newLeads}</td><td>{r.outreach}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="empty"><b>No sales activity yet</b>Add leads and deals, or set targets below, and each rep shows up here.</div>}
      </div>

      <div className="grid2">
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Lead funnel</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Leads created in the period and how far they got.</p>
          {m.funnel[0].count ? (
            <ol className="funnel">{m.funnel.map((f, i) => (
              <li key={f.label}>
                <span>{f.label}</span>
                <span className="track" aria-hidden="true"><span className="fill" style={{ width: `${(f.count / top) * 100}%` }} /></span>
                <span><b>{f.count}</b>{i > 0 && <span className="muted"> · {pct(m.funnel[i - 1].count ? f.count / m.funnel[i - 1].count : null)}</span>}</span>
              </li>
            ))}</ol>
          ) : <p className="muted">No new leads in this period.</p>}
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Open deals by stage</h2>
          <div className="tablewrap scroll">
            <table style={{ minWidth: 0 }}>
              <thead><tr><th>Stage</th><th>Deals</th><th>Value</th></tr></thead>
              <tbody>{m.byStage.map((s) => <tr key={s.stage}><td>{s.stage}</td><td>{s.count}</td><td>{money(s.value)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Needs attention</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Open deals past their expected close date, or with no stage change in {STALE_DAYS}+ days.</p>
        {m.attention.length ? (
          <div className="list attention">{m.attention.map((d) => (
            <div key={d.id} className="li">
              <OpenRecord kind="deals" id={d.id} className="link x"><b>{d.title}</b><span className="muted">{[d.client, d.stage, money(d.value), d.ownerId ? repName.get(d.ownerId) ?? 'Former team member' : 'Unassigned'].filter(Boolean).join(' · ')}</span></OpenRecord>
              <span className="pill a">{d.reason}</span>
            </div>
          ))}</div>
        ) : <p className="muted">Nothing stalled. Every open deal has moved in the last {STALE_DAYS} days and none is past its close date.</p>}
      </div>

      {isAdmin && (
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Monthly targets</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Revenue each rep should win in a month. Leave blank for no target.</p>
          <SalesTargets reps={reps} months={targetMonths} targets={targetRows} canEdit={canEdit(ctx)} />
        </div>
      )}
    </>
  );
}
