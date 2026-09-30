'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Drawer from './Drawer';
import { useRecords } from './Records';
import { TIMEZONES } from '@/lib/timeclock';

type Geo = { lat: number; lng: number; acc: number | null } | null;
export type TcEntry = {
  id: string; applicationId: string; job: string; inDate: string; inTime: string; outDate: string | null; outTime: string | null;
  breakMinutes: number; minutes: number; open: boolean; flags: { level: 'warn' | 'info'; text: string }[];
  editReason: string | null; original: string | null; inGeo: Geo; outGeo: Geo;
  offSite?: string | null; // e.g. "1.2 miles from the site" or "no location shared"
};
export type TcWorker = {
  candidateId: string; name: string; canText: boolean; canEmail: boolean; apps: { id: string; label: string }[];
  entries: TcEntry[]; regular: number; overtime: number; locked: boolean;
};
type Form = { id?: string; applicationId: string; inDate: string; inTime: string; outDate: string; outTime: string; breakMinutes: number; reason: string };

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Try again.');
  return json;
}
const hm = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;
const clock = (t: string | null) => { if (!t) return '—'; const h = +t.slice(0, 2); return `${h % 12 || 12}:${t.slice(3)} ${h < 12 ? 'AM' : 'PM'}`; };
const day = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const map = (g: NonNullable<Geo>) => `https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lng}#map=17/${g.lat}/${g.lng}`;

export default function TimeclockBoard({ week, workers, totalHours, canEdit, isAdmin, timesheets, timezone, timezoneLabel }: {
  week: string; workers: TcWorker[]; totalHours: number; canEdit: boolean; isAdmin: boolean; timesheets: boolean; timezone: string; timezoneLabel: string;
}) {
  const router = useRouter();
  const { toast } = useRecords();
  const [form, setForm] = useState<Form | null>(null);
  const [linkFor, setLinkFor] = useState<TcWorker | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const withApps = workers.filter((w) => w.apps.length);

  async function fill() {
    setBusy(true);
    try {
      const r = await api('/api/timeclock/fill', 'POST', { week });
      toast([`Filled ${r.filled} timesheet${r.filled === 1 ? '' : 's'} from clocked hours.`, r.locked.length ? `Skipped (already approved): ${r.locked.join(', ')}.` : '', r.openEntries.length ? `Still clocked in: ${r.openEntries.join(', ')} — not counted yet.` : ''].filter(Boolean).join(' '), !r.filled);
      router.refresh();
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  async function save() {
    if (!form) return;
    setBusy(true); setError('');
    const body = { inDate: form.inDate, inTime: form.inTime, outDate: form.outDate || null, outTime: form.outTime || null, breakMinutes: form.breakMinutes, reason: form.reason };
    try {
      if (form.id) await api(`/api/timeclock/entries/${form.id}`, 'PATCH', body);
      else await api('/api/timeclock/entries', 'POST', { ...body, applicationId: form.applicationId });
      toast(form.id ? 'Entry updated.' : 'Entry added.'); setForm(null); router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!form?.id) return;
    if (!form.reason.trim()) return setError('Say why you’re removing it (in the reason box).');
    if (!confirm('Delete this time entry?')) return;
    setBusy(true);
    try { await api(`/api/timeclock/entries/${form.id}`, 'DELETE', { reason: form.reason }); toast('Entry deleted.'); setForm(null); router.refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const addFor = (w: TcWorker) => { setError(''); setForm({ applicationId: w.apps[0].id, inDate: week, inTime: '07:00', outDate: week, outTime: '15:30', breakMinutes: 30, reason: '' }); };
  const edit = (e: TcEntry) => { setError(''); setForm({ id: e.id, applicationId: e.applicationId, inDate: e.inDate, inTime: e.inTime, outDate: e.outDate ?? e.inDate, outTime: e.outTime ?? '', breakMinutes: e.breakMinutes, reason: '' }); };

  return (
    <>
      <div className="bar">
        <span className="muted">{+totalHours.toFixed(2)} hours clocked this week · times in {timezoneLabel} time</span>
        <span className="grow" />
        {canEdit && timesheets && <button className="btn" onClick={fill} disabled={busy}>Fill timesheets from time clock</button>}
      </div>
      {withApps.length ? withApps.map((w) => (
        <section key={w.candidateId} className="card tcworker">
          <div className="payworkerhead">
            <div><b>{w.name}</b><span className="muted">{w.apps.map((a) => a.label).join(' · ')}</span></div>
            <div className="paytotal"><b>{+(w.regular + w.overtime).toFixed(2)} h</b><span className="muted">{w.overtime ? `${+w.regular.toFixed(2)} regular · ${+w.overtime.toFixed(2)} overtime` : 'regular'}{w.locked ? ' · timesheet approved' : ''}</span></div>
          </div>
          {w.entries.length ? (
            <div className="tablewrap scroll"><table className="paylines">
              <thead><tr><th>Day</th><th>In</th><th>Out</th><th>Break</th><th>Worked</th><th>Notes</th>{canEdit && <th />}</tr></thead>
              <tbody>{w.entries.map((e) => (
                <tr key={e.id} className="tcrow">
                  <td>{day(e.inDate)}{w.apps.length > 1 && <div className="muted">{e.job}</div>}</td>
                  <td>{clock(e.inTime)}{e.inGeo && <div><a className="muted" href={map(e.inGeo)} target="_blank" rel="noopener noreferrer">location{e.inGeo.acc ? ` ±${Math.round(e.inGeo.acc)}m` : ''}</a></div>}</td>
                  <td>{e.open ? <span className="pill g">On the clock</span> : <>{clock(e.outTime)}{e.outDate && e.outDate !== e.inDate && <span className="muted"> (+1 day)</span>}</>}{e.outGeo && <div><a className="muted" href={map(e.outGeo)} target="_blank" rel="noopener noreferrer">location</a></div>}</td>
                  <td>{e.breakMinutes ? `${e.breakMinutes} min` : '—'}</td>
                  <td><b>{hm(e.minutes)}</b></td>
                  <td><div className="tcflags">{e.offSite && <span className="pill r" title="Outside the job site’s geofence">Off site: {e.offSite}</span>}{e.flags.map((f) => <span key={f.text} className={`pill ${f.level === 'warn' ? 'r' : ''}`}>{f.text}</span>)}</div>
                    {e.editReason && <div className="muted" style={{ fontSize: 12.5 }}>“{e.editReason}”{e.original ? ` · was ${e.original}` : ''}</div>}</td>
                  {canEdit && <td><button className="btn ghost sm" disabled={w.locked} onClick={() => edit(e)}>Edit</button></td>}
                </tr>
              ))}</tbody>
            </table></div>
          ) : <p className="muted" style={{ margin: '4px 0' }}>No punches this week.</p>}
          {canEdit && (
            <div className="row">
              <button className="btn ghost sm" disabled={w.locked} onClick={() => addFor(w)}>+ Add missed punch</button>
              <button className="btn ghost sm" onClick={() => setLinkFor(w)}>Send time clock link</button>
            </div>
          )}
        </section>
      )) : <div className="card empty"><b>No one on assignment</b>Place candidates on a contract, temp or per diem job, then send them a time clock link.</div>}

      {isAdmin && canEdit && <TimezoneCard timezone={timezone} />}

      {form && (
        <Drawer title={form.id ? 'Edit time entry' : 'Add missed punch'} kicker={withApps.find((w) => w.apps.some((a) => a.id === form.applicationId))?.name} onClose={() => setForm(null)} footer={<>
          <button className="btn" onClick={save} disabled={busy}>{form.id ? 'Save changes' : 'Add entry'}</button>
          <button className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
          <span style={{ flex: 1 }} />
          {form.id && <button className="btn danger" onClick={remove} disabled={busy}>Delete</button>}
        </>}>
          {!form.id && (withApps.find((w) => w.apps.some((a) => a.id === form.applicationId))?.apps.length ?? 0) > 1 && (
            <label><span>Assignment</span><select value={form.applicationId} onChange={(e) => setForm({ ...form, applicationId: e.target.value })}>
              {withApps.find((w) => w.apps.some((a) => a.id === form.applicationId))!.apps.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
          )}
          <div className="form">
            <label><span>Clock-in date</span><input type="date" value={form.inDate} onChange={(e) => setForm({ ...form, inDate: e.target.value, outDate: form.outDate || e.target.value })} /></label>
            <label><span>Clock-in time</span><input type="time" value={form.inTime} onChange={(e) => setForm({ ...form, inTime: e.target.value })} /></label>
            <label><span>Clock-out date</span><input type="date" value={form.outDate} onChange={(e) => setForm({ ...form, outDate: e.target.value })} /></label>
            <label><span>Clock-out time</span><input type="time" value={form.outTime} onChange={(e) => setForm({ ...form, outTime: e.target.value })} /></label>
            <label><span>Breaks (minutes)</span><input type="number" min={0} max={480} inputMode="numeric" value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: Number(e.target.value) || 0 })} /></label>
            <label className="full"><span>Reason (kept with the entry)</span><input value={form.reason} maxLength={300} placeholder="e.g. Forgot to clock out; confirmed with supervisor" onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>Times are in {timezoneLabel} time. Leave clock-out blank to keep the entry open.</p>
          {error && <p className="error" role="alert">{error}</p>}
        </Drawer>
      )}
      {linkFor && <LinkDrawer w={linkFor} onClose={() => setLinkFor(null)} />}
    </>
  );
}

function LinkDrawer({ w, onClose }: { w: TcWorker; onClose: () => void }) {
  const { toast } = useRecords();
  const [sms, setSms] = useState(w.canText);
  const [email, setEmail] = useState(w.canEmail && !w.canText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function send() {
    setBusy(true); setError('');
    try {
      const r = await api('/api/timeclock/link', 'POST', { candidateId: w.candidateId, channels: [sms && 'sms', email && 'email'].filter(Boolean) });
      if (r.sent.length) { toast(`Time clock link sent by ${r.sent.map((c: string) => (c === 'sms' ? 'text' : 'email')).join(' and ')}.`); onClose(); }
      else setError(r.problems.join(' ') || 'It couldn’t be sent.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Send time clock link" kicker={w.name} onClose={onClose} footer={<><button className="btn" onClick={send} disabled={busy || (!sms && !email)}>{busy ? 'Sending…' : 'Send link'}</button><button className="btn ghost" onClick={onClose}>Cancel</button></>}>
      <p>{w.name.split(' ')[0]} gets a private link to clock in and out, take breaks and see their shifts. It works for a year and replaces any link you sent before (the old one stops working).</p>
      <div className="row" role="group" aria-label="Send by">
        <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={sms} disabled={!w.canText} onChange={(e) => setSms(e.target.checked)} /> Text message{!w.canText && ' (no mobile number or opted out)'}</label>
        <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={email} disabled={!w.canEmail} onChange={(e) => setEmail(e.target.checked)} /> Email{!w.canEmail && ' (no email or opted out)'}</label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </Drawer>
  );
}

function TimezoneCard({ timezone }: { timezone: string }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [tz, setTz] = useState(timezone);
  async function save() {
    try { await api('/api/timeclock/settings', 'PATCH', { timezone: tz }); toast('Time zone saved.'); router.refresh(); } catch (e) { toast((e as Error).message, true); }
  }
  return (
    <div className="card">
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Time zone</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Decides which day and workweek (Monday–Sunday) each punch counts toward.</p>
      <div className="row" style={{ marginTop: 0 }}>
        <select value={tz} onChange={(e) => setTz(e.target.value)} aria-label="Time zone">{TIMEZONES.map(([z, l]) => <option key={z} value={z}>{l}</option>)}</select>
        <button className="btn ghost" onClick={save} disabled={tz === timezone}>Save</button>
      </div>
    </div>
  );
}
