import { requirePageContext } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import Gate from '@/components/Gate';
import AcaTracking from '@/components/Aca';
import { overview } from '@/lib/aca-server';

export const dynamic = 'force-dynamic';
const fmt = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export default async function AcaPage() {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'aca')) return <Gate title="ACA tracking" feature="ACA tracking" />;
  if (ctx.role !== 'OWNER' && ctx.role !== 'ADMIN') return <div className="card empty"><b>ACA tracking is limited to admins</b>Ask an owner or admin on your team for access.</div>;
  const o = await overview(ctx.tdb);
  const year = +o.today.slice(0, 4);
  const r = o.cycles.running;
  return (
    <>
      <h1>ACA tracking</h1>
      <p className="lede">Who counts as full-time under the Affordable Care Act, using the look-back measurement method and your approved hours. Offer coverage to full-time workers to avoid IRS penalties, and keep a record of every offer for Form 1095-C.</p>
      <div className="kpis" style={{ margin: '16px 0' }}>
        <div className="kpi"><b className={o.counts.offerNow ? 'warn' : ''}>{o.counts.offerNow}</b><span>Full-time, no offer</span></div>
        <div className="kpi"><b>{o.counts.offerSoon}</b><span>On track for full-time</span><span className="sub">offer coverage next stability period</span></div>
        <div className="kpi"><b>{o.counts.watch}</b><span>Close to 30 hours</span></div>
        <div className="kpi"><b>{o.ale.average}</b><span>Full-time + equivalents in {o.ale.priorYear}</span><span className="sub">{o.ale.ale ? `50 or more: the employer mandate applies in ${year}` : `under 50: the employer mandate doesn’t apply in ${year}`}</span></div>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Measuring now: {fmt(r.measurement.start)} – {fmt(r.measurement.end)}{r.admin ? `, then an administrative period to ${fmt(r.admin.end)}` : ''}; results apply {fmt(r.stability.start)} – {fmt(r.stability.end)}.
        {o.cycles.stable ? ` Current stability period: ${fmt(o.cycles.stable.stability.start)} – ${fmt(o.cycles.stable.stability.end)}.` : ''}
        {' '}Hours come from approved timesheets (worked plus paid time off); salaried employees count 40 hours a week.
      </p>
      <AcaTracking rows={o.rows} policy={o.policy} counts={o.counts} />
      <section className="card">
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Form 1095-C data</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Suggested codes for lines 14, 15 and 16 for each month, for everyone who was full-time at least one month or enrolled. Give it to your payroll provider or filing service to check and file. Safe-harbor codes (2F, 2G, 2H) depend on wages, so they’re left blank for the filer.</p>
        <div className="row">{[year - 1, year].map((y) => <a key={y} className="btn ghost" href={`/api/aca/1095?year=${y}`}>Download {y}</a>)}</div>
      </section>
      <p className="muted" style={{ fontSize: 12 }}>This tracking supports your ACA compliance but isn’t legal or tax advice. Seasonal-worker exceptions and educational-organization break rules aren’t applied; confirm your measurement method with your benefits advisor.</p>
    </>
  );
}
