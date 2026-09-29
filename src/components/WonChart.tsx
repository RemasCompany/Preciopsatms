'use client';
import { useEffect, useRef, useState } from 'react';

type Point = { month: string; won: number; target: number | null };

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const short = (n: number) => (n >= 1e6 ? `$${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${+(n / 1e3).toFixed(0)}k` : `$${n}`);
const monthName = (m: string, withYear = false) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: withYear ? 'long' : 'short', year: withYear ? 'numeric' : undefined, timeZone: 'UTC' });

/** Round axis ticks: 0 and three steps of 1, 2 or 5 × 10ⁿ covering the max. */
function ticks(max: number) {
  if (max <= 0) return [0, 1000, 2000, 3000];
  const raw = max / 3, mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((s) => s * mag >= raw) ?? 10) * mag;
  return [0, step, step * 2, step * 3];
}

/** Won revenue per month as columns, with each month's target as a tick across its column. */
export default function WonChart({ data }: { data: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the real width so text stays 12px on phones instead of shrinking with a viewBox.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const H = 240, L = 52, R = 8, T = 12, B = 28;
  const yt = ticks(Math.max(...data.map((d) => Math.max(d.won, d.target ?? 0))));
  const top = yt[yt.length - 1];
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const slot = (W - L - R) / data.length, bw = Math.min(24, slot * 0.5);
  const cx = (i: number) => L + slot * i + slot / 2;
  const hasTarget = data.some((d) => d.target);
  const h = hover == null ? null : data[hover];

  return (
    <figure className="chart">
      <div className="legend" aria-hidden="true">
        <span><i className="sw won" />Won revenue</span>
        {hasTarget && <span><i className="sw target" />Target</span>}
      </div>
      <div className="plot" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Won revenue by month${hasTarget ? ' against target' : ''}. Table view below.`} onMouseLeave={() => setHover(null)}>
          {yt.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={t ? 'grid' : 'base'} />
              <text x={L - 8} y={y(t)} dy="0.32em" textAnchor="end" className="axis">{short(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = cx(i) - bw / 2, top = y(d.won), base = y(0), r = Math.min(4, (base - top) / 2);
            return (
              <g key={d.month} tabIndex={0} role="button" aria-label={`${monthName(d.month, true)}: won ${money(d.won)}${d.target ? `, target ${money(d.target)}` : ''}`}
                onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} className={hover === i ? 'col on' : 'col'}>
                <rect x={cx(i) - slot / 2} y={T} width={slot} height={H - T - B} className="hit" />
                {d.won > 0 && <path className="won" d={`M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${base}Z`} />}
                {d.target ? <line className="target" x1={cx(i) - bw / 2 - 6} x2={cx(i) + bw / 2 + 6} y1={y(d.target)} y2={y(d.target)} /> : null}
                <text x={cx(i)} y={H - 8} textAnchor="middle" className="axis">{monthName(d.month)}</text>
              </g>
            );
          })}
        </svg>
        {h && (
          <div className="tip" style={{ left: `clamp(90px, ${(cx(hover!) / W) * 100}%, calc(100% - 90px))` }} role="status">
            <b>{monthName(h.month, true)}</b>
            <span><i className="sw won" />Won {money(h.won)}</span>
            {h.target ? <span><i className="sw target" />Target {money(h.target)} · {Math.round((h.won / h.target) * 100)}%</span> : <span className="muted">No target set</span>}
          </div>
        )}
      </div>
      <details className="tableview">
        <summary>Show as table</summary>
        <div className="tablewrap scroll">
          <table>
            <thead><tr><th>Month</th><th>Won</th><th>Target</th><th>Attainment</th></tr></thead>
            <tbody>{data.map((d) => (
              <tr key={d.month}><td>{monthName(d.month, true)}</td><td>{money(d.won)}</td><td>{d.target ? money(d.target) : '—'}</td><td>{d.target ? `${Math.round((d.won / d.target) * 100)}%` : '—'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
