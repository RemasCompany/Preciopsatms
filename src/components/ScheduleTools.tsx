'use client';
import { jsonWithOverride } from '@/lib/cert-override';
import { useEffect, useMemo, useState } from 'react';
import Drawer from './Drawer';
import { SHIFT_PRESETS, WEEK_HOURS_BEFORE_OT, clock, dayLabel, overnight, shiftHours } from '@/lib/schedule';
import type { BoardRow, BoardShift } from './ScheduleBoard';

type Times = { start: string; end: string; breakMinutes: number };
type PlanItem = { applicationId: string; worker: string; job: string; dates: string[]; hours: number; weekHours: number; blocked: string | null; certGaps: string[]; warnings: string[] };
type Done = (msg: string, warnings?: string[]) => void;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const rowLabel = (r: BoardRow) => [r.job, r.client].filter(Boolean).join(' · ');

function TimeFields({ t, set }: { t: Times; set: (t: Times) => void }) {
  const hours = t.start && t.end && t.start !== t.end ? shiftHours(t) : 0;
  return <>
    <div className="row presets" role="group" aria-label="Common shifts">
      {SHIFT_PRESETS.map((p) => <button key={p.label} type="button" className={`btn ghost sm${t.start === p.start && t.end === p.end ? ' on' : ''}`} onClick={() => set({ start: p.start, end: p.end, breakMinutes: p.breakMinutes })}>{p.label}</button>)}
    </div>
    <div className="form">
      <label><span>Start</span><input type="time" value={t.start} step={900} onChange={(e) => set({ ...t, start: e.target.value })} /></label>
      <label><span>End</span><input type="time" value={t.end} step={900} onChange={(e) => set({ ...t, end: e.target.value })} /></label>
      <label><span>Unpaid break (minutes)</span><input type="number" min={0} max={240} step={5} inputMode="numeric" value={t.breakMinutes} onChange={(e) => set({ ...t, breakMinutes: Number(e.target.value) || 0 })} /></label>
    </div>
    {hours > 0 && <p className="muted">{+hours.toFixed(2)} paid hours a shift{overnight(t.start, t.end) ? ', ends the next day' : ''}. Over {WEEK_HOURS_BEFORE_OT} hours in a week is overtime.</p>}
  </>;
}

/** Create schedule: pick workers and days, set the shift once, check the preview, add everything at once. */
export function BuildDrawer({ rows, days, onClose, onDone }: { rows: BoardRow[]; days: string[]; onClose: () => void; onDone: Done }) {
  const jobs = useMemo(() => [...new Map(rows.map((r) => [r.jobId, rowLabel(r)])).entries()], [rows]);
  const [job, setJob] = useState(jobs.length === 1 ? jobs[0][0] : '');
  const [picked, setPicked] = useState<string[]>([]);
  const [dates, setDates] = useState<string[]>(days.slice(0, 5));
  const [t, setT] = useState<Times>({ start: '07:00', end: '15:30', breakMinutes: 30 });
  const [unit, setUnit] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<PlanItem[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shown = rows.filter((r) => !job || r.jobId === job);
  const allOn = shown.length > 0 && shown.every((r) => picked.includes(r.applicationId));
  const valid = picked.length > 0 && dates.length > 0 && t.start && t.end && t.start !== t.end;

  // Live preview: who can't be scheduled, overtime and other warnings, before anything is saved.
  useEffect(() => {
    if (!valid) { setItems(null); return; }
    let live = true;
    setChecking(true);
    const id = setTimeout(async () => {
      try {
        const r = await jsonWithOverride('/api/shifts/bulk', 'POST', { dryRun: true, applicationIds: picked, dates, ...t });
        if (live) { setItems(r.items); setError(''); }
      } catch (e) { if (live) { setItems(null); setError((e as Error).message); } }
      finally { if (live) setChecking(false); }
    }, 300);
    return () => { live = false; clearTimeout(id); };
  }, [valid, picked, dates, t]);

  const ready = (items ?? []).filter((i) => !i.blocked);
  const count = ready.reduce((n, i) => n + i.dates.length, 0);
  async function add() {
    setBusy(true); setError('');
    try {
      const r = await jsonWithOverride('/api/shifts/bulk', 'POST', { applicationIds: ready.map((i) => i.applicationId), dates, ...t, unit: unit || null, notes: notes || null });
      const skipped = (items ?? []).length - ready.length;
      onDone(`${plural(r.created, 'shift')} added for ${plural(ready.length, 'worker')}${skipped ? ` (${skipped} skipped)` : ''}. Publish when the week is ready.`, r.warnings);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const toggle = (id: string, on: boolean) => setPicked(on ? [...picked, id] : picked.filter((x) => x !== id));
  const setDays = (ds: string[]) => setDates(ds);

  return (
    <Drawer title="Create schedule" kicker={`Week of ${dayLabel(days[0], { month: 'short', day: 'numeric' })}`} onClose={onClose} footer={<>
      <button className="btn" onClick={add} disabled={busy || checking || !count}>{count ? `Add ${plural(count, 'shift')} for ${plural(ready.length, 'worker')}` : 'Add shifts'}</button>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
    </>}>
      {jobs.length > 1 && (
        <label><span>Job</span>
          <select value={job} onChange={(e) => { const j = e.target.value; setJob(j); setPicked(picked.filter((id) => !j || rows.find((r) => r.applicationId === id)?.jobId === j)); }}>
            <option value="">All jobs</option>{jobs.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
      )}
      <fieldset className="picklist"><legend>Workers <button type="button" className="linkbtn" onClick={() => setPicked(allOn ? picked.filter((id) => !shown.some((r) => r.applicationId === id)) : [...new Set([...picked, ...shown.map((r) => r.applicationId)])])}>{allOn ? 'Clear' : 'Select all'}</button></legend>
        {shown.map((r) => (
          <label key={r.applicationId} className="check"><input type="checkbox" checked={picked.includes(r.applicationId)} onChange={(e) => toggle(r.applicationId, e.target.checked)} /> <b>{r.worker}</b>{!job && <span className="muted"> · {rowLabel(r)}</span>}</label>
        ))}
      </fieldset>
      <fieldset className="days"><legend>Days <span className="row" style={{ display: 'inline-flex', gap: 4, margin: '0 0 0 8px' }}>
        <button type="button" className="linkbtn" onClick={() => setDays(days.slice(0, 5))}>Weekdays</button>
        <button type="button" className="linkbtn" onClick={() => setDays(days.slice(5))}>Weekend</button>
        <button type="button" className="linkbtn" onClick={() => setDays(days)}>All</button></span></legend>
        {days.map((d) => (
          <label key={d} className="check"><input type="checkbox" checked={dates.includes(d)} onChange={(e) => setDates(e.target.checked ? [...dates, d].sort() : dates.filter((x) => x !== d))} /> {dayLabel(d, { weekday: 'short', day: 'numeric' })}</label>
        ))}
      </fieldset>
      <TimeFields t={t} set={setT} />
      <div className="form">
        <label><span>Unit / post</span><input value={unit} maxLength={80} placeholder="e.g. Dock 2, Lobby" onChange={(e) => setUnit(e.target.value)} /></label>
        <label className="full"><span>Notes for the workers</span><textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </div>

      <h3 className="previewh">Preview{checking && <span className="muted"> · checking…</span>}</h3>
      {!valid ? <p className="muted">Choose workers and days to see the schedule before it’s added.</p> : items && (
        <div className="list preview">{items.map((i) => (
          <div key={i.applicationId} className={`li${i.blocked ? ' blocked' : ''}`}>
            <div className="x"><b>{i.worker}</b>
              <span className="muted">{i.blocked ? 'Won’t be added' : `${plural(i.dates.length, 'shift')} · ${i.hours}h · ${i.weekHours}h this week`}</span>
              {i.blocked && <span className="error">{i.blocked}</span>}
              {i.certGaps.map((g) => <span key={g} className="warn">Not certified: {g}</span>)}
              {i.warnings.map((w) => <span key={w} className="warn">{w}</span>)}
            </div>
            <span className={`pill ${i.blocked ? 'r' : i.warnings.length || i.certGaps.length ? 'a' : 'g'}`}>{i.blocked ? 'Skipped' : i.warnings.length || i.certGaps.length ? 'Check' : 'Ready'}</span>
          </div>
        ))}</div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </Drawer>
  );
}

export type Picked = { r: BoardRow; s: BoardShift };

/** Change times, or move to other days or another worker, for every selected shift. */
export function BulkDrawer({ mode, picked, rows, onClose, onDone }: { mode: 'times' | 'move'; picked: Picked[]; rows: BoardRow[]; onClose: () => void; onDone: Done }) {
  const first = picked[0].s;
  const [t, setT] = useState<Times>({ start: first.start, end: first.end, breakMinutes: first.breakMinutes });
  const [unit, setUnit] = useState('');
  const [notes, setNotes] = useState('');
  const [moveDays, setMoveDays] = useState(0);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sent = picked.filter((p) => p.s.everSent).length;
  const workers = new Set(picked.map((p) => p.r.applicationId));

  async function save() {
    const change = mode === 'times' ? { ...t, ...(unit ? { unit } : {}), ...(notes ? { notes } : {}) } : { ...(moveDays ? { moveDays } : {}), ...(to ? { applicationId: to } : {}) };
    setBusy(true); setError('');
    try {
      const r = await jsonWithOverride('/api/shifts/bulk', 'PATCH', { ids: picked.map((p) => p.s.id), change });
      onDone(`${plural(r.updated, 'shift')} changed.${r.needsNotice ? ' Publish to send the changes.' : ''}`, r.warnings);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Drawer title={mode === 'times' ? 'Change times' : 'Move shifts'} kicker={`${plural(picked.length, 'shift')} · ${plural(workers.size, 'worker')}`} onClose={onClose} footer={<>
      <button className="btn" onClick={save} disabled={busy || (mode === 'move' && !moveDays && !to)}>{mode === 'times' ? `Change ${plural(picked.length, 'shift')}` : `Move ${plural(picked.length, 'shift')}`}</button>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
    </>}>
      {mode === 'times' ? <>
        <TimeFields t={t} set={setT} />
        <div className="form">
          <label><span>Unit / post</span><input value={unit} maxLength={80} placeholder="Leave as is" onChange={(e) => setUnit(e.target.value)} /></label>
          <label className="full"><span>Notes for the worker</span><textarea rows={2} maxLength={500} value={notes} placeholder="Leave as is" onChange={(e) => setNotes(e.target.value)} /></label>
        </div>
      </> : <div className="form">
        <label><span>Day</span>
          <select value={moveDays} onChange={(e) => setMoveDays(Number(e.target.value))}>
            {[-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n === 0 ? 'Same day' : `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'} ${n < 0 ? 'earlier' : 'later'}`}</option>)}
          </select>
        </label>
        <label><span>Worker</span>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">{workers.size === 1 ? 'Same worker' : 'Same workers'}</option>
            {rows.map((r) => <option key={r.applicationId} value={r.applicationId}>{r.worker} — {rowLabel(r)}</option>)}
          </select>
        </label>
      </div>}
      <ul className="picked">{picked.slice(0, 8).map(({ r, s }) => <li key={s.id}>{r.worker} · {dayLabel(s.date)} {clock(s.start)}–{clock(s.end)}</li>)}{picked.length > 8 && <li className="muted">and {picked.length - 8} more</li>}</ul>
      {sent > 0 && <p className="muted">{sent === picked.length ? 'These workers were' : `${sent} of these workers were`} already told about their shift. Changes go out the next time you publish{mode === 'move' && to ? '; a shift handed to someone else is sent to the first worker as a cancellation' : ''}.</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </Drawer>
  );
}
