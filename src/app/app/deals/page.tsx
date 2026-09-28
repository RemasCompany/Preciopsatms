import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { DEAL_STAGES, DEAL_PROBABILITY, dealKpis } from '@/lib/deals';
import DealsBoard from '@/components/DealsBoard';
import { OpenRecord } from '@/components/Records';
import Gate from '@/components/Gate';

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default async function Deals() {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'crm')) return <Gate title="Deals" feature="CRM" />;
  const rows = await ctx.tdb.deal.findMany({ include: { client: { select: { name: true } } }, orderBy: [{ closeDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }] });
  const deals = rows.map((d) => ({ id: d.id, title: d.title, client: d.client?.name ?? null, value: d.value == null ? null : Number(d.value), stage: d.stage, closeDate: d.closeDate?.toISOString().slice(0, 10) ?? null }));
  const k = dealKpis(deals);
  return (
    <>
      <h1>Deals</h1>
      <p className="lede">Sales opportunities with existing and prospective clients. Weighted value uses stage probability: {DEAL_STAGES.map((s) => `${s} ${Math.round(DEAL_PROBABILITY[s] * 100)}%`).join(', ')}.</p>
      <div className="kpis" style={{ margin: '16px 0' }}>
        <div className="kpi"><b>{money(k.open)}</b><span>Open pipeline</span></div>
        <div className="kpi"><b>{money(k.weighted)}</b><span>Weighted</span></div>
        <div className="kpi"><b>{money(k.won)}</b><span>Won</span></div>
        <div className="kpi"><b>{k.winRate == null ? '—' : `${Math.round(k.winRate * 100)}%`}</b><span>Win rate</span></div>
      </div>
      {canEdit(ctx) && <div className="bar"><OpenRecord kind="deals" className="btn">+ Add deal</OpenRecord></div>}
      {deals.length ? <DealsBoard deals={deals} /> : <div className="card empty"><b>No deals yet</b>Convert a qualified lead or add a deal for an existing client.</div>}
    </>
  );
}
