'use client';
import { useEffect, useState } from 'react';

export type ClockData = {
  timezone: string;
  assignments: { id: string; label: string }[];
  open: { id: string; applicationId: string; clockIn: string; onBreak: boolean; breakStartedAt: string | null; breakMinutes: number } | null;
  recent: { id: string; date: string; job: string; in: string; out: string; breakMinutes: number; minutes: number }[];
};

const hm = (m: number) => `${Math.floor(m / 60)}h ${String(Math.floor(m % 60)).padStart(2, '0')}m`;

/** A worker's clock-in/out card on their private page. Location is attached only if they allow it. */
export default function TimeClock({ token, data, onChange }: { token: string; data: ClockData; onChange: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [app, setApp] = useState(data.open?.applicationId ?? data.assignments[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
  const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: data.timezone });
  const o = data.open;
  const worked = o ? Math.max(0, (now - Date.parse(o.clockIn)) / 60000 - o.breakMinutes - (o.breakStartedAt ? (now - Date.parse(o.breakStartedAt)) / 60000 : 0)) : 0;

  const where = () => new Promise<{ lat: number; lng: number; accuracy: number } | undefined>((resolve) => {
    if (!('geolocation' in navigator)) return resolve(undefined);
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }), () => resolve(undefined), { timeout: 6000, maximumAge: 60000 });
  });
  async function act(action: 'in' | 'break-start' | 'break-end' | 'out') {
    if (action === 'out' && !confirm('Clock out now?')) return;
    setBusy(true); setMsg(null);
    const geo = action === 'in' || action === 'out' ? await where() : undefined;
    const r = await fetch(`/api/public/clock/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, applicationId: app || undefined, geo }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? { text: j.message } : { text: j.error ?? 'That didn’t go through. Try again.', bad: true });
    onChange();
  }

  return (
    <section className={`card clockcard${o ? (o.onBreak ? ' onbreak' : ' on') : ''}`} aria-live="polite">
      <div className="clockhead">
        <span className="clockstate">{o ? (o.onBreak ? 'On break' : 'Clocked in') : 'Not clocked in'}</span>
        <span className="muted">{new Date(now).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: data.timezone })}</span>
      </div>
      {o ? (
        <>
          <p className="clockbig">{hm(worked)}</p>
          <p className="muted" style={{ marginTop: 0 }}>Since {time(o.clockIn)}{o.breakMinutes ? ` · ${o.breakMinutes} min of breaks` : ''}{o.onBreak && o.breakStartedAt ? ` · break started ${time(o.breakStartedAt)}` : ''} · {data.assignments.find((a) => a.id === o.applicationId)?.label}</p>
          <div className="row clockbtns">
            {o.onBreak ? <button className="btn" disabled={busy} onClick={() => act('break-end')}>End break</button>
              : <button className="btn ghost" disabled={busy} onClick={() => act('break-start')}>Start break</button>}
            <button className="btn danger" disabled={busy} onClick={() => act('out')}>Clock out</button>
          </div>
        </>
      ) : data.assignments.length ? (
        <>
          {data.assignments.length > 1 && (
            <label><span>Assignment</span><select value={app} onChange={(e) => setApp(e.target.value)}>{data.assignments.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
          )}
          {data.assignments.length === 1 && <p className="muted" style={{ marginTop: 4 }}>{data.assignments[0].label}</p>}
          <button className="btn clockin" disabled={busy || !app} onClick={() => act('in')}>{busy ? 'Clocking in…' : 'Clock in'}</button>
        </>
      ) : <p className="muted">You’re not on an assignment right now.</p>}
      {msg && <p className={msg.bad ? 'error' : 'okc'} role="status">{msg.text}</p>}
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>If your phone asks, allowing location attaches where you clocked in and out. You can still clock in without it.</p>
      {data.recent.length > 0 && (
        <details className="clockrecent"><summary>Recent hours</summary>
          <ul>{data.recent.map((e) => <li key={e.id}><span>{new Date(`${e.date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} · {time(e.in)}–{time(e.out)}</span><b>{hm(e.minutes)}</b></li>)}</ul>
        </details>
      )}
    </section>
  );
}
