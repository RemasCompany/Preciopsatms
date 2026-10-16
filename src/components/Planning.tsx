'use client';
import { useRouter } from 'next/navigation';
import { TimeChart, type Series } from './Charts';
import type { Planning } from '@/lib/planning-server';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const hrs = (n: number) => `${Math.round(n).toLocaleString('en-US')}`;
const usd = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdShort = (d: number) => (d >= 1e6 ? `$${(d / 1e6).toFixed(1)}M` : d >= 1e3 ? `$${Math.round(d / 1e3)}k` : `$${Math.round(d)}`);
const day = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dayY = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const delta = (v: number | null, unit = '%') => (v == null ? 'no data last year' : `${v > 0 ? '▲' : v < 0 ? '▼' : '='} ${Math.abs(v)}${unit} vs last year`);

/** The current month projected (actual so far + forecast weeks), then the months the 13-week forecast fully covers. */
function projected(p: Planning, money: boolean) {
  if (!p.overall) return Array(12).fill(null) as (number | null)[];
  const rate = p.ytd.costPerHour.thisYear ?? 0;
  const out: (number | null)[] = Array(12).fill(null);
  const cur = Number(p.lastWeek.slice(5, 7)) - 1, last = p.overall.forecast[p.overall.forecast.length - 1].week;
  const byMonth = new Map<number, number>();
  for (const w of p.overall.forecast) { const m = Number(w.week.slice(5, 7)) - 1; if (w.week.slice(0, 4) === String(p.year)) byMonth.set(m, (byMonth.get(m) ?? 0) + w.hours); }
  const actual = p.monthly[cur]?.thisYear?.hours ?? 0;
  for (const [m, h] of byMonth) {
    const monthEnd = new Date(Date.UTC(p.year, m + 1, 0)).toISOString().slice(0, 10);
    if (m !== cur && monthEnd > last) continue; // only months the forecast covers to the end
    const hours = m === cur ? actual + h : h;
    out[m] = money ? hours * rate * 100 : hours;
  }
  // Join the dashed line to the last full actual month.
  const lastFull = p.monthly[cur]?.partial ? cur - 1 : cur;
  if (lastFull >= 0 && p.monthly[lastFull]?.thisYear) out[lastFull] = money ? p.monthly[lastFull].thisYear!.costCents : p.monthly[lastFull].thisYear!.hours;
  return out;
}

export default function PlanningView({ p, money, groups, years }: { p: Planning; money: boolean; groups: { key: string; label: string }[]; years: number[] }) {
  const router = useRouter();
  const go = (k: string, v: string) => { const u = new URL(window.location.href); u.searchParams.set(k, v); router.push(`${u.pathname}?${u.searchParams}`); };
  const current = p.year === p.thisYear;
  const cur = Number(p.lastWeek.slice(5, 7)) - 1;
  const partial = current && p.monthly[cur]?.partial;
  // Actual months: the current partial month is shown as a projection instead, so it doesn't look like a drop.
  const actual = (f: (m: Planning['monthly'][number]) => number) => p.monthly.map((m, i) => (m.thisYear && !(partial && i === cur) ? f(m) : null));
  const hoursSeries: Series[] = [
    { key: 'ly', name: `${p.year - 1}`, color: '--series-2', values: p.monthly.map((m) => m.lastYearFull.hours) },
    { key: 'ty', name: `${p.year}`, color: '--series-1', values: actual((m) => m.thisYear!.hours), noEndLabel: current },
    ...(current ? [{ key: 'fc', name: 'Forecast', color: '--series-1', dashed: true, values: projected(p, false) }] : []),
  ];
  const costSeries: Series[] = [
    { key: 'ly', name: `${p.year - 1}`, color: '--series-2', values: p.monthly.map((m) => m.lastYearFull.costCents / 100) },
    { key: 'ty', name: `${p.year}`, color: '--series-1', values: actual((m) => m.thisYear!.costCents / 100), noEndLabel: current },
    ...(current ? [{ key: 'fc', name: 'Forecast', color: '--series-1', dashed: true, values: projected(p, true).map((v) => (v == null ? null : v / 100)) }] : []),
  ];
  const o = p.overall;
  const weekLabels = o?.forecast.map((w) => day(w.week)) ?? [];
  const weekSeries: Series[] = o ? [
    { key: 'need', name: 'Hours needed', color: '--series-1', kind: 'bar', values: o.forecast.map((w) => w.hours) },
    { key: 'cap', name: 'Current team', color: '--series-3', values: o.capacity.weeks.map((w) => w.hours) },
    { key: 'ly', name: 'Last year', color: '--series-2', values: o.forecast.map((w) => w.lastYear || null) },
  ] : [];
  const h = o?.hiring;
  const ytd = p.ytd;

  return (
    <>
      <div className="bar">
        <label className="row" style={{ gap: 6, margin: 0 }}><span className="muted">Year</span>
          <select value={p.year} onChange={(e) => go('year', e.target.value)} aria-label="Year">{years.map((y) => <option key={y} value={y}>{y} vs {y - 1}</option>)}</select></label>
        <label className="row" style={{ gap: 6, margin: 0 }}><span className="muted">Plan by</span>
          <select value={p.group} onChange={(e) => go('group', e.target.value)} aria-label="Plan by">{groups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}</select></label>
        <span className="grow" />
        <a className="btn ghost" href={`/api/planning/export?year=${p.year}&group=${p.group}`}>Download CSV</a>
      </div>

      {!p.weeks ? (
        <div className="card empty"><b>No approved hours yet</b>Labor planning uses approved timesheets. Once a few weeks are approved, this page compares them with last year, forecasts the hours you’ll need, and suggests when to hire.</div>
      ) : <>
        <div className="kpis">
          <div className="kpi"><b>{hrs(ytd.thisYear.hours)}</b><span>Hours {current ? 'so far this year' : `in ${p.year}`}</span><span className="delta">{delta(ytd.change.hours)}</span></div>
          {money && <div className="kpi"><b>{usd(ytd.thisYear.costCents)}</b><span>Labor cost {current ? 'so far' : ''}</span><span className="delta">{delta(ytd.change.costCents)}</span></div>}
          {money && <div className="kpi"><b>{ytd.costPerHour.thisYear ? `$${ytd.costPerHour.thisYear.toFixed(2)}` : '—'}</b><span>Cost per hour</span><span className="delta">{ytd.costPerHour.lastYear ? `$${ytd.costPerHour.lastYear.toFixed(2)} last year` : 'no data last year'}</span></div>}
          <div className="kpi"><b>{ytd.avgWorkers.thisYear}</b><span>People working, avg week</span><span className="delta">{ytd.avgWorkers.lastYear ? `${ytd.avgWorkers.lastYear} last year` : 'no data last year'}</span></div>
          <div className="kpi"><b>{ytd.thisYear.hours ? `${Math.round((ytd.thisYear.overtime / ytd.thisYear.hours) * 1000) / 10}%` : '—'}</b><span>Overtime share of hours</span><span className="delta">{delta(ytd.change.overtimeShare, ' pts')}</span></div>
        </div>
        {!p.hasHistory && <p className="muted">There are no approved hours from {p.year - 1} yet, so the comparison and forecast use this year’s recent weeks only.</p>}

        <div className="plan-grid">
          <section className="card">
            <h2 style={{ margin: '0 0 2px', fontSize: 18 }}>Hours worked by month</h2>
            <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>{p.year} against {p.year - 1}{current ? `. The dashed line is the forecast${partial ? `, including ${MONTHS[cur]} so far (through ${day(p.lastWeek)})` : ''}.` : '.'}</p>
            <TimeChart title={`Hours worked by month, ${p.year} vs ${p.year - 1}`} labels={MONTHS} series={hoursSeries} format={(n) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : `${Math.round(n)}`)} />
            <MonthTable p={p} pick={(t) => t.hours} fmt={hrs} />
          </section>
          {money ? (
            <section className="card">
              <h2 style={{ margin: '0 0 2px', fontSize: 18 }}>Labor cost by month</h2>
              <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>Gross pay for the hours (overtime at 1.5x, paid time off included){current ? '; the forecast uses this year’s cost per hour' : ''}.</p>
              <TimeChart title={`Labor cost by month, ${p.year} vs ${p.year - 1}`} labels={MONTHS} series={costSeries} format={usdShort} />
              <MonthTable p={p} pick={(t) => t.costCents} fmt={usd} />
            </section>
          ) : (
            <section className="card">
              <h2 style={{ margin: '0 0 2px', fontSize: 18 }}>People working by month</h2>
              <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>Different people with approved hours in the month.</p>
              <TimeChart title={`People working by month, ${p.year} vs ${p.year - 1}`} labels={MONTHS} series={[{ key: 'ly', name: `${p.year - 1}`, color: '--series-2', values: p.monthly.map((m) => m.lastYearFull.workers) }, { key: 'ty', name: `${p.year}`, color: '--series-1', values: actual((m) => m.thisYear!.workers) }]} format={(n) => `${Math.round(n)}`} />
              <MonthTable p={p} pick={(t) => t.workers} fmt={(n) => `${n}`} />
            </section>
          )}
        </div>

        {o && h && <>
          <section className="card" style={{ marginTop: 16 }}>
            <h2 style={{ margin: '0 0 2px', fontSize: 18 }}>Next 13 weeks: hours needed vs your current team</h2>
            <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
              {o.forecast[0]?.basis === 'last-year' ? 'Last year’s same weeks, scaled by how this year is running against last' : 'This year’s recent weekly average (no history from last year)'}; shifts already scheduled set a floor.
              The current team is the {o.capacity.active} {o.capacity.active === 1 ? 'person' : 'people'} who worked in the last 4 weeks at a typical {o.capacity.hoursPerWorker} hours a week{o.capacity.turnoverQuarterly ? `, less ${o.capacity.turnoverQuarterly}% turnover a quarter` : ''}.
            </p>
            <TimeChart title="Hours needed each week against the current team's capacity" labels={weekLabels} series={weekSeries} format={(n) => `${Math.round(n)}`} />
            <details className="vtable"><summary>Show as a table</summary><div className="tablewrap"><table>
              <thead><tr><th>Week ending</th><th>Needed</th><th>Scheduled so far</th><th>Same week last year</th><th>Current team</th><th>Short by</th></tr></thead>
              <tbody>{h.weeks.map((w, i) => <tr key={w.week}><td>{dayY(w.week)}</td><td>{hrs(w.need)}</td><td>{o.forecast[i].scheduled ? hrs(o.forecast[i].scheduled) : '—'}</td><td>{o.forecast[i].lastYear ? hrs(o.forecast[i].lastYear) : '—'}</td><td>{hrs(w.capacity)}</td>
                <td>{w.gapPeople > 0 ? `${w.gapPeople} people (${hrs(w.gapHours)} h)` : '—'}</td></tr>)}</tbody>
            </table></div></details>
          </section>

          <section className="card" style={{ marginTop: 16 }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>Hiring plan</h2>
            <p style={{ margin: '0 0 8px' }}>{h.hires > 0
              ? <><b>Hire {h.hires} {h.hires === 1 ? 'person' : 'people'}</b>{h.openReqs ? ` (plus the ${h.openReqs} open requisition${h.openReqs === 1 ? '' : 's'} already posted)` : ''} — start by <b>{dayY(h.startBy!)}</b> so they’re working by the week of {day(h.firstShortWeek!)}. {h.late ? 'That date has passed: start now, and cover the gap with overtime or temporary staff.' : ''} At the peak (week of {day(h.peak!.week)}) you’ll need about {hrs(h.peak!.need)} hours against {hrs(h.peak!.capacity)} your current team covers.</>
              : h.needed > 0 ? <><b>Your open jobs cover it.</b> Fill the {h.openReqs} open {h.openReqs === 1 ? 'position' : 'positions'} {h.late ? 'now' : `by ${dayY(h.startBy!)}`} so they’re working by the week of {day(h.firstShortWeek!)}.</>
                : h.surplus > 0 ? <><b>No hires needed.</b> Your team has room for about {h.surplus} more {h.surplus === 1 ? 'person’s' : 'people’s'} worth of hours every week of the next 13 — a chance to cut overtime or take on more work.</>
                  : <><b>No hires needed.</b> Your current team covers the hours forecast for the next 13 weeks.</>}</p>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>Start-by dates allow {p.timeToFill} days to hire{p.timeToFillMeasured ? ', your typical time to fill over the last year' : ' (a typical time to fill; yours will be used once you’ve filled a few jobs)'}.</p>
            {p.segments.length > 0 && (
              <div className="tablewrap" style={{ marginTop: 12 }}><table>
                <thead><tr><th>{groups.find((g) => g.key === p.group)?.label}</th><th>Hours this year</th><th>vs last year</th><th>People now</th><th>Peak need</th><th>Short by</th><th>Open jobs</th><th>Hire</th><th>Start by</th></tr></thead>
                <tbody>{p.segments.map((s) => (
                  <tr key={s.name}><td><b>{s.name}</b></td><td>{hrs(s.ytd.thisYear.hours)}</td><td>{s.ytd.change.hours == null ? '—' : `${s.ytd.change.hours > 0 ? '+' : ''}${s.ytd.change.hours}%`}</td><td>{s.capacity.active}</td>
                    <td>{s.hiring.peak ? `${hrs(s.hiring.peak.need)} h, wk of ${day(s.hiring.peak.week)}` : '—'}</td><td>{s.hiring.peak && s.hiring.peak.gapPeople >= 0.5 ? `${s.hiring.peak.gapPeople} people` : '—'}</td><td>{s.hiring.openReqs || '—'}</td>
                    <td>{s.hiring.hires ? <b>{s.hiring.hires}</b> : s.hiring.needed ? <span className="muted">Open jobs cover it</span> : '—'}</td><td className={s.hiring.late && s.hiring.hires ? 'warnnum' : undefined}>{s.hiring.hires && s.hiring.startBy ? (s.hiring.late ? 'Now (late)' : dayY(s.hiring.startBy)) : '—'}</td></tr>
                ))}</tbody>
              </table></div>
            )}
            {p.segments.length > 0 && <p className="muted" style={{ fontSize: 13 }}>Each row is planned on its own, so the rows can add up to a little more than the plan for everyone (rounding to whole people).</p>}
          </section>
        </>}
        {!current && <p className="muted">Forecasts and the hiring plan are for the current year. Choose {p.thisYear} to see them.</p>}
      </>}
    </>
  );
}

function MonthTable({ p, pick, fmt }: { p: Planning; pick: (t: Planning['monthly'][number]['lastYear']) => number; fmt: (n: number) => string }) {
  return (
    <details className="vtable"><summary>Show as a table</summary><div className="tablewrap"><table>
      <thead><tr><th>Month</th><th>{p.year}</th><th>{p.year - 1}</th><th>Change</th></tr></thead>
      <tbody>{p.monthly.map((m) => {
        const a = m.thisYear ? pick(m.thisYear) : null, b = pick(m.lastYear);
        return <tr key={m.month}><td>{MONTHS[m.month - 1]}{m.partial ? ' (so far)' : ''}</td><td>{a == null ? '—' : fmt(a)}</td><td>{fmt(b)}{m.partial ? ' (same weeks)' : ''}</td><td>{a != null && b ? `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 1000) / 10}%` : '—'}</td></tr>;
      })}</tbody>
    </table></div></details>
  );
}
