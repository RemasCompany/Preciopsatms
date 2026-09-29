'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Drawer from './Drawer';
import { useRecords } from './Records';
import { SHIFT_PRESETS, WEEK_HOURS_BEFORE_OT, clock, dayLabel, overnight, shiftHours, weekHours } from '@/lib/schedule';

export type BoardShift = {
  id: string; date: string; start: string; end: string; breakMinutes: number; unit: string | null; notes: string | null;
  cancelled: boolean; notified: boolean; everSent: boolean; response: 'PENDING' | 'CONFIRMED' | 'DECLINED'; declineReason: string | null;
};
export type BoardRow = {
  applicationId: string; candidateId: string; worker: string; job: string; client: string | null;
  email: string | null; phone: string | null; emailOptOut: boolean; smsOptOut: boolean; credIssue: string | null; shifts: BoardShift[];
};
type Form = { id?: string; applicationId: string; dates: string[]; date: string; start: string; end: string; breakMinutes: number; unit: string; notes: string };

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Try again.');
  return json;
}

/** Where a shift stands, from the worker's side. */
export function shiftState(s: BoardShift): { key: string; label: string } {
  if (s.cancelled) return s.notified ? { key: 'cancelled', label: 'Cancelled' } : { key: 'cancel-unsent', label: 'Cancellation not sent' };
  if (!s.notified) return s.everSent ? { key: 'changed', label: 'Changed — not sent' } : { key: 'draft', label: 'Not sent' };
  return { CONFIRMED: { key: 'confirmed', label: 'Confirmed' }, DECLINED: { key: 'declined', label: 'Can’t make it' }, PENDING: { key: 'sent', label: 'Sent — awaiting reply' } }[s.response];
}
const needsSend = (s: BoardShift) => !s.notified && (!s.cancelled || s.everSent);
const ICON: Record<string, string> = { confirmed: '✓', declined: '✕', sent: '•', draft: '', changed: '', 'cancel-unsent': '', cancelled: '' };

export default function ScheduleBoard({ week, days, rows, canEdit, today }: { week: string; days: string[]; rows: BoardRow[]; canEdit: boolean; today: string }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [publishing, setPublishing] = useState(false);

  const pending = rows.filter((r) => r.shifts.some(needsSend));
  const pendingShifts = rows.reduce((n, r) => n + r.shifts.filter(needsSend).length, 0);
  const done = (msg: string, warnings: string[] = []) => { toast(warnings.length ? `${msg} Heads up: ${warnings.join(' ')}` : msg, false); setForm(null); router.refresh(); };

  const newShift = (applicationId: string, date: string) => { setError(''); setForm({ applicationId, dates: [date], date, start: '07:00', end: '19:00', breakMinutes: 30, unit: '', notes: '' }); };
  const editShift = (r: BoardRow, s: BoardShift) => { setError(''); setForm({ id: s.id, applicationId: r.applicationId, dates: [s.date], date: s.date, start: s.start, end: s.end, breakMinutes: s.breakMinutes, unit: s.unit ?? '', notes: s.notes ?? '' }); };

  async function save() {
    if (!form) return;
    setBusy(true); setError('');
    const fields = { start: form.start, end: form.end, breakMinutes: form.breakMinutes, unit: form.unit || null, notes: form.notes || null };
    try {
      if (form.id) {
        const r = await api(`/api/shifts/${form.id}`, 'PATCH', { date: form.date, ...fields });
        done(r.needsNotice ? 'Saved. Publish to send the change.' : 'Saved.', r.warnings);
      } else {
        const r = await api('/api/shifts', 'POST', { applicationId: form.applicationId, dates: form.dates, ...fields });
        done(`${r.created} shift${r.created === 1 ? '' : 's'} added. Publish when the week is ready.`, r.warnings);
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove(s: BoardShift) {
    const told = s.everSent && !s.cancelled;
    if (!confirm(told ? 'Cancel this shift? The worker is told when you publish.' : 'Delete this shift?')) return;
    setBusy(true);
    try { const r = await api(`/api/shifts/${s.id}`, 'DELETE'); done(r.deleted ? 'Shift deleted.' : 'Shift cancelled. Publish to tell the worker.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function copyLast() {
    setBusy(true);
    try {
      const r = await api('/api/schedule/copy', 'POST', { week });
      toast(r.copied ? `Copied ${r.copied} shift${r.copied === 1 ? '' : 's'} from last week${r.skipped ? ` (${r.skipped} skipped — they overlap shifts already here)` : ''}.` : r.skipped ? 'Every shift from last week overlaps one already here.' : 'Last week has no shifts to copy.', !r.copied);
      router.refresh();
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }

  const row = form ? rows.find((r) => r.applicationId === form.applicationId) : null;
  const editing = form?.id ? row?.shifts.find((s) => s.id === form.id) : null;
  const hoursPreview = form && form.start && form.end && form.start !== form.end ? shiftHours(form) : 0;

  const Chip = ({ r, s }: { r: BoardRow; s: BoardShift }) => {
    const st = shiftState(s);
    return (
      <button type="button" className={`shift ${st.key}`} onClick={() => (canEdit && !s.cancelled ? editShift(r, s) : undefined)} disabled={!canEdit || s.cancelled}
        title={`${st.label}${s.declineReason ? `: “${s.declineReason}”` : ''}`} aria-label={`${r.worker}, ${dayLabel(s.date)} ${clock(s.start)} to ${clock(s.end)}${s.unit ? `, ${s.unit}` : ''}. ${st.label}.`}>
        <span className="t">{clock(s.start)}–{clock(s.end)}{overnight(s.start, s.end) ? '⁺' : ''}{ICON[st.key] && <i aria-hidden="true">{ICON[st.key]}</i>}</span>
        {s.unit && <span className="u">{s.unit}</span>}
        <span className="st">{st.label}</span>
      </button>
    );
  };

  return (
    <>
      <div className="bar">
        {canEdit && <button className="btn ghost" onClick={copyLast} disabled={busy}>Copy last week</button>}
        <span className="grow" />
        {canEdit && <button className="btn" onClick={() => setPublishing(true)} disabled={!pending.length}>{pending.length ? `Publish & notify (${pendingShifts})` : 'All changes sent'}</button>}
      </div>

      {!rows.length ? (
        <div className="card empty"><b>No one on assignment</b>Place candidates on a contract, temp or per diem job from the Pipeline, and they appear here to schedule.</div>
      ) : <>
        <div className="tablewrap scroll schedwrap">
          <table className="sched">
            <thead><tr><th scope="col">Worker</th>{days.map((d) => <th key={d} scope="col" className={d === today ? 'today' : undefined}>{dayLabel(d, { weekday: 'short' })}<small>{dayLabel(d, { month: 'short', day: 'numeric' })}</small></th>)}<th scope="col">Hours</th></tr></thead>
            <tbody>{rows.map((r) => {
              const live = r.shifts.filter((s) => !s.cancelled);
              const h = weekHours(live);
              return (
                <tr key={r.applicationId}>
                  <th scope="row"><b>{r.worker}</b><span className="muted">{[r.job, r.client].filter(Boolean).join(' · ')}</span>{r.credIssue && <span className="warn">{r.credIssue}</span>}</th>
                  {days.map((d) => (
                    <td key={d} className={d === today ? 'today' : undefined}>
                      {r.shifts.filter((s) => s.date === d).map((s) => <Chip key={s.id} r={r} s={s} />)}
                      {canEdit && <button type="button" className="addshift" onClick={() => newShift(r.applicationId, d)} aria-label={`Add a shift for ${r.worker} on ${dayLabel(d)}`}>+</button>}
                    </td>
                  ))}
                  <td className="hrs"><b>{+h.total.toFixed(2)}</b>{h.overtime > 0 && <span className="soon">{+h.overtime.toFixed(2)} OT</span>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>

        {/* Phones: one day at a time, stacked. */}
        <div className="daylist">
          {days.map((d) => {
            const items = rows.flatMap((r) => r.shifts.filter((s) => s.date === d).map((s) => ({ r, s }))).sort((a, b) => a.s.start.localeCompare(b.s.start));
            return (
              <section key={d} className={`card day${d === today ? ' today' : ''}`}>
                <h3>{dayLabel(d, { weekday: 'long', month: 'short', day: 'numeric' })}<small>{items.filter((x) => !x.s.cancelled).length} shift{items.filter((x) => !x.s.cancelled).length === 1 ? '' : 's'}</small></h3>
                {items.map(({ r, s }) => (
                  <div key={s.id} className="dayrow"><div className="x"><b>{r.worker}</b><span className="muted">{[r.job, r.client].filter(Boolean).join(' · ')}</span></div><Chip r={r} s={s} /></div>
                ))}
                {canEdit && <button className="btn ghost sm" onClick={() => newShift(rows[0].applicationId, d)}>+ Add shift</button>}
              </section>
            );
          })}
        </div>
        <p className="legend schedlegend" aria-label="Legend">
          <span><i className="shiftdot draft" />Not sent</span><span><i className="shiftdot sent" />Sent, awaiting reply</span>
          <span><i className="shiftdot confirmed" />Confirmed</span><span><i className="shiftdot declined" />Can’t make it</span><span><i className="shiftdot cancelled" />Cancelled</span>
          <span>⁺ ends the next day</span>
        </p>
      </>}

      {form && row && (
        <Drawer title={form.id ? 'Edit shift' : 'Add shift'} kicker={row.worker} onClose={() => setForm(null)} footer={<>
          <button className="btn" onClick={save} disabled={busy || (!form.id && !form.dates.length)}>{form.id ? 'Save shift' : `Add ${form.dates.length > 1 ? `${form.dates.length} shifts` : 'shift'}`}</button>
          <button className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
          <span style={{ flex: 1 }} />
          {editing && <button className="btn danger" onClick={() => remove(editing)} disabled={busy}>{editing.everSent ? 'Cancel shift' : 'Delete'}</button>}
        </>}>
          {!form.id && (
            <label><span>Worker</span>
              <select value={form.applicationId} onChange={(e) => setForm({ ...form, applicationId: e.target.value })}>
                {rows.map((r) => <option key={r.applicationId} value={r.applicationId}>{r.worker} — {[r.job, r.client].filter(Boolean).join(', ')}</option>)}
              </select>
            </label>
          )}
          {form.id ? (
            <label><span>Date</span><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
          ) : (
            <fieldset className="days"><legend>Days</legend>
              {days.map((d) => (
                <label key={d} className="check"><input type="checkbox" checked={form.dates.includes(d)} onChange={(e) => setForm({ ...form, dates: e.target.checked ? [...form.dates, d] : form.dates.filter((x) => x !== d) })} /> {dayLabel(d, { weekday: 'short', day: 'numeric' })}</label>
              ))}
            </fieldset>
          )}
          <div className="row presets" role="group" aria-label="Common shifts">
            {SHIFT_PRESETS.map((p) => <button key={p.label} type="button" className={`btn ghost sm${form.start === p.start && form.end === p.end ? ' on' : ''}`} onClick={() => setForm({ ...form, start: p.start, end: p.end, breakMinutes: p.breakMinutes })}>{p.label}</button>)}
          </div>
          <div className="form">
            <label><span>Start</span><input type="time" value={form.start} step={900} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label>
            <label><span>End</span><input type="time" value={form.end} step={900} onChange={(e) => setForm({ ...form, end: e.target.value })} /></label>
            <label><span>Unpaid break (minutes)</span><input type="number" min={0} max={240} step={5} inputMode="numeric" value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: Number(e.target.value) || 0 })} /></label>
            <label><span>Unit / post</span><input value={form.unit} maxLength={80} placeholder="e.g. ICU, Lobby" onChange={(e) => setForm({ ...form, unit: e.target.value })} /></label>
            <label className="full"><span>Notes for the worker</span><textarea rows={2} maxLength={500} value={form.notes} placeholder="e.g. Report to the 3rd floor nurses’ station" onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          </div>
          {hoursPreview > 0 && <p className="muted">{+hoursPreview.toFixed(2)} paid hours{overnight(form.start, form.end) ? ', ends the next day' : ''}. Over {WEEK_HOURS_BEFORE_OT} hours in a week is overtime.</p>}
          {editing && editing.everSent && <p className="muted">The worker already has this shift. Changes go out the next time you publish{editing.response !== 'PENDING' ? ', and new times need to be confirmed again' : ''}.</p>}
          {editing?.declineReason && <p className="warn">They said: “{editing.declineReason}”</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </Drawer>
      )}

      {publishing && <PublishDrawer week={week} rows={pending} onClose={() => setPublishing(false)} onDone={() => router.refresh()} />}
    </>
  );
}

function PublishDrawer({ week, rows, onClose, onDone }: { week: string; rows: BoardRow[]; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState(true);
  const [sms, setSms] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<{ worker: string; shifts: number; delivered: string[]; problems: string[] }[] | null>(null);
  const reach = (r: BoardRow) => [email && r.email && !r.emailOptOut && 'email', sms && r.phone && !r.smsOptOut && 'text'].filter(Boolean);
  async function go() {
    setBusy(true); setError('');
    try { const r = await api('/api/schedule/publish', 'POST', { week, channels: [email && 'email', sms && 'sms'].filter(Boolean), applicationIds: rows.map((x) => x.applicationId) }); setResults(r.results); onDone(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Drawer title={results ? 'Schedule sent' : 'Publish & notify'} kicker={`Week ending ${dayLabel(week, { month: 'short', day: 'numeric' })}`} onClose={onClose}
      footer={results ? <button className="btn" onClick={onClose}>Done</button> : <><button className="btn" onClick={go} disabled={busy || (!email && !sms)}>{busy ? 'Sending…' : `Notify ${rows.length} worker${rows.length === 1 ? '' : 's'}`}</button><button className="btn ghost" onClick={onClose}>Cancel</button></>}>
      {results ? (
        <div className="list">{results.map((r) => (
          <div key={r.worker} className="li"><div className="x"><b>{r.worker}</b><span className="muted">{r.shifts} shift{r.shifts === 1 ? '' : 's'}{r.problems.length ? ` · ${r.problems.join(', ')}` : ''}</span></div>
            <span className={`pill ${r.delivered.length ? 'g' : 'r'}`}>{r.delivered.length ? `Sent by ${r.delivered.map((c) => (c === 'sms' ? 'text' : c)).join(' & ')}` : 'Not reached — call them'}</span></div>
        ))}</div>
      ) : <>
        <p>Each worker gets one message with their new, changed and cancelled shifts, and a private link to confirm each one.</p>
        <div className="row" role="group" aria-label="Send by">
          <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Email</label>
          <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={sms} onChange={(e) => setSms(e.target.checked)} /> Text message</label>
        </div>
        <div className="list" style={{ marginTop: 12 }}>{rows.map((r) => {
          const via = reach(r);
          return (
            <div key={r.applicationId} className="li"><div className="x"><b>{r.worker}</b><span className="muted">{r.shifts.filter(needsSend).length} shift{r.shifts.filter(needsSend).length === 1 ? '' : 's'} to send</span></div>
              <span className={`pill ${via.length ? '' : 'r'}`}>{via.length ? `By ${via.join(' & ')}` : 'No way to reach them'}</span></div>
          );
        })}</div>
        <p className="muted" style={{ fontSize: 13 }}>People who opted out of email or texts aren’t contacted that way. Workers also get a reminder the day before each shift.</p>
        {error && <p className="error" role="alert">{error}</p>}
      </>}
    </Drawer>
  );
}
