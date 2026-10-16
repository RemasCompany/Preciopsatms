'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * Small SVG charts for the planning page. Colors come from CSS custom properties (.viz in globals.css, with their own
 * dark-mode steps), lines are 2px, the grid is a 1px hairline, every chart has a hover tooltip, a legend for two or more
 * series with direct end labels, and a table view (rendered by the caller).
 */
export type Series = { key: string; name: string; color: string; values: (number | null)[]; dashed?: boolean; kind?: 'line' | 'bar'; noEndLabel?: boolean };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <div className="vlegend" aria-hidden>
      {series.map((s) => (
        <span key={s.key}><svg width="22" height="10"><line x1="1" x2="21" y1="5" y2="5" stroke={`var(${s.color})`} strokeWidth={s.kind === 'bar' ? 8 : 2} strokeDasharray={s.dashed ? '4 3' : undefined} strokeLinecap="round" /></svg>{s.name}</span>
      ))}
    </div>
  );
}

/** Lines (and optionally bars) over categories, one y-axis. */
export function TimeChart({ labels, series, format, title, height = 240, labelEvery = 1, endLabels = true }: {
  labels: string[]; series: Series[]; format: (n: number) => string; title: string; height?: number; labelEvery?: number; endLabels?: boolean;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at the container's real width, so text stays its true size on a phone.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const H = height, L = 52, R = endLabels ? (W < 480 ? 72 : 96) : 12, T = 12, B = 28;
  const every = Math.max(labelEvery, Math.ceil(labels.length / Math.max(3, Math.floor((W - L - R) / 46))));
  const max = useMemo(() => niceMax(Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0)))), [series]);
  const n = labels.length, step = (W - L - R) / n;
  const x = (i: number) => L + step * (i + 0.5), y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const bars = series.filter((s) => s.kind === 'bar'), lines = series.filter((s) => s.kind !== 'bar');
  const bw = Math.min(28, step * 0.62 / Math.max(1, bars.length));
  // Direct end labels: the last value of each line, nudged apart so they don't collide.
  const ends = lines.filter((s) => !s.noEndLabel).map((s) => { let i = s.values.length - 1; while (i >= 0 && s.values[i] == null) i--; return i < 0 ? null : { s, i, y: y(s.values[i]!) }; }).filter(Boolean) as { s: Series; i: number; y: number }[];
  ends.sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 14) ends[k].y = ends[k - 1].y + 14;
  const tip = hover === null ? null : { i: hover, rows: series.filter((s) => s.values[hover] != null).map((s) => ({ s, v: s.values[hover]! })) };
  return (
    <div className="viz" role="img" aria-labelledby={`${id}-t`}>
      <span id={`${id}-t`} className="sr-only">{title}. The table below has the numbers.</span>
      {series.length > 1 && <Legend series={series} />}
      <div className="vwrap" ref={box}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="vsvg" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="vgrid" /><text x={L - 8} y={y(t) + 4} className="vaxis" textAnchor="end">{format(t)}</text></g>)}
          {labels.map((l, i) => (i % every === 0 || i === n - 1) && <text key={l + i} x={x(i)} y={H - 8} className="vaxis" textAnchor="middle">{l}</text>)}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="vcross" />}
          {bars.map((s, bi) => s.values.map((v, i) => v != null && v > 0 && (
            <path key={`${s.key}${i}`} d={roundedBar(x(i) - (bw * bars.length) / 2 + bi * bw + 1, y(v), bw - 2, H - B - y(v))} fill={`var(${s.color})`} />
          )))}
          {lines.map((s) => {
            const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)] as const));
            const segs: string[] = []; let cur = '';
            pts.forEach((p) => { if (!p) { if (cur) segs.push(cur); cur = ''; } else cur += `${cur ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`; });
            if (cur) segs.push(cur);
            return <g key={s.key}>
              {segs.map((d, k) => <path key={k} d={d} fill="none" stroke={`var(${s.color})`} strokeWidth={2} strokeDasharray={s.dashed ? '6 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />)}
              {hover !== null && s.values[hover] != null && <circle cx={x(hover)} cy={y(s.values[hover]!)} r={4.5} fill={`var(${s.color})`} className="vdot" />}
            </g>;
          })}
          {endLabels && ends.map((e) => <text key={e.s.key} x={x(e.i) + 8} y={e.y + 4} className="vlabel">{e.s.name}</text>)}
          {labels.map((l, i) => <rect key={`h${i}`} x={x(i) - step / 2} y={T} width={step} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} />)}
        </svg>
        {tip && (
          <div className="vtip" style={{ left: Math.min(Math.max(x(tip.i), 90), W - 90) }}>
            <b>{labels[tip.i]}</b>
            {tip.rows.map(({ s, v }) => <div key={s.key}><i style={{ background: `var(${s.color})` }} />{s.name}<span>{format(v)}</span></div>)}
          </div>
        )}
      </div>
    </div>
  );
}

/** A bar with 4px rounded top corners, anchored square on the baseline. */
function roundedBar(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
