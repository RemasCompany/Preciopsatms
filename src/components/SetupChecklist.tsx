'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Step } from '@/lib/setup-checklist';

/** A setup checklist that ticks itself off from real data. It can be folded away, and goes once everything is done. */
export default function SetupChecklist({ id, title, steps }: { id: string; title: string; steps: Step[] }) {
  const done = steps.filter((s) => s.done).length, next = steps.find((s) => !s.done);
  const [open, setOpen] = useState(true);
  useEffect(() => { try { if (localStorage.getItem(`setup:${id}`) === 'folded') setOpen(false); } catch { /* storage blocked */ } }, [id]);
  const fold = (o: boolean) => { setOpen(o); try { localStorage.setItem(`setup:${id}`, o ? 'open' : 'folded'); } catch { /* storage blocked */ } };
  if (!next) return null;
  return (
    <section className="card setup" aria-label={title}>
      <div className="setuphead">
        <div><b>{title}</b><span className="muted"> · {done} of {steps.length} done</span></div>
        <button className="btn ghost sm" onClick={() => fold(!open)} aria-expanded={open}>{open ? 'Hide' : 'Show steps'}</button>
      </div>
      <div className="setupbar" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label={`${done} of ${steps.length} steps done`}><i style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      {open ? (
        <ol className="setupsteps">{steps.map((s) => (
          <li key={s.key} className={s.done ? 'done' : s === next ? 'next' : ''}>
            <span className="tick" aria-hidden>{s.done ? '✓' : ''}</span>
            <div><b>{s.label}</b>{s.done ? <span className="sr-only"> (done)</span> : null}<p className="muted">{s.hint}</p></div>
            {!s.done && (s.href.startsWith('#') ? <a className={`btn sm ${s === next ? '' : 'ghost'}`} href={s.href}>{s.action}</a> : <Link className={`btn sm ${s === next ? '' : 'ghost'}`} href={s.href}>{s.action}</Link>)}
          </li>
        ))}</ol>
      ) : <p className="muted" style={{ margin: '6px 0 0' }}>Next: {next.label}</p>}
    </section>
  );
}
