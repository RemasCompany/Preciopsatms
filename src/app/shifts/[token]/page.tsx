'use client';
import { useCallback, useEffect, useState } from 'react';
import { clockLong, dayLabel, overnight, shiftHours } from '@/lib/schedule';
import TimeClock, { type ClockData } from '@/components/TimeClock';
import WorkerOnboarding, { type WorkerOb } from '@/components/WorkerOnboarding';
import WorkerEngagement, { type WorkerEng } from '@/components/WorkerEngagement';

type Shift = {
  id: string; date: string; start: string; end: string; breakMinutes: number; unit: string | null; notes: string | null;
  job: string; client: string | null; location: string | null; state: 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'updating'; past: boolean;
};
type Data = { company: string; brandColor: string; contactEmail: string | null; logoUrl: string | null; firstName: string; shifts: Shift[]; clock: ClockData | null; onboarding?: WorkerOb[]; engagement?: WorkerEng | null };

const STATE: Record<Shift['state'], { text: string; cls: string }> = {
  pending: { text: 'Please confirm', cls: 'a' }, confirmed: { text: 'Confirmed', cls: 'g' }, declined: { text: 'You can’t make it', cls: 'r' },
  cancelled: { text: 'Cancelled', cls: 'r' }, updating: { text: 'Being updated', cls: '' },
};

/** A worker's own schedule, from the private link in their notice: see shifts, confirm or decline each one. */
export default function MyShifts({ params }: { params: { token: string } }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const r = await fetch(`/api/public/shifts/${params.token}`);
    const j = await r.json().catch(() => ({}));
    if (r.ok) setData(j); else setError(j.error ?? 'This link isn’t working.');
  }, [params.token]);
  useEffect(() => { load(); }, [load]);

  async function respond(s: Shift, response: 'CONFIRMED' | 'DECLINED') {
    setBusy(s.id); setNote('');
    const r = await fetch(`/api/public/shifts/${params.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shiftId: s.id, response, reason: response === 'DECLINED' ? reason : undefined }) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { setNote(j.error ?? 'That didn’t go through. Try again.'); return; }
    setDeclining(null); setReason('');
    setNote(response === 'CONFIRMED' ? `Thanks — you’re confirmed for ${dayLabel(s.date)}.` : `Got it. We’ll let the team know you can’t make ${dayLabel(s.date)}.`);
    load();
  }

  if (!data) return <main className="public"><p className={error ? 'error' : 'muted'}>{error || 'Loading…'}</p></main>;
  const upcoming = data.shifts.filter((s) => !s.past);
  const toConfirm = upcoming.filter((s) => s.state === 'pending').length;
  return (
    <main className="public myshifts" style={{ ['--accent' as string]: data.brandColor }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {data.logoUrl && /^https:\/\//.test(data.logoUrl) && <img className="careers-logo" src={data.logoUrl} alt={data.company} />}
      <p className="muted" style={{ margin: 0 }}>{data.company}</p>
      <h1>Hi {data.firstName}{data.clock || data.onboarding?.length ? '' : ', here’s your schedule'}</h1>
      {!!data.onboarding?.length && <WorkerOnboarding token={params.token} items={data.onboarding} onChange={load} />}
      {data.clock && <TimeClock token={params.token} data={data.clock} onChange={load} />}
      {data.engagement && <WorkerEngagement token={params.token} data={data.engagement} onChange={load} />}
      {(data.clock || !!data.onboarding?.length) && <h2 style={{ marginBottom: 4 }}>Your schedule</h2>}
      <p className="lede">{toConfirm ? `${toConfirm} shift${toConfirm === 1 ? '' : 's'} waiting for you to confirm.` : upcoming.length ? 'You’re all set.' : 'You have no upcoming shifts.'}</p>
      {note && <p className="card banner" role="status">{note}</p>}
      <ul className="shiftlist">
        {upcoming.map((s) => (
          <li key={s.id} className={`card shiftcard ${s.state}`}>
            <div className="shifthead">
              <b>{dayLabel(s.date, { weekday: 'long', month: 'long', day: 'numeric' })}</b>
              <span className={`pill ${STATE[s.state].cls}`}>{STATE[s.state].text}</span>
            </div>
            <p className="shifttime">{clockLong(s.start)} – {clockLong(s.end)}{overnight(s.start, s.end) ? ' (next day)' : ''} <span className="muted">· {+shiftHours(s).toFixed(2)} hours{s.breakMinutes ? `, ${s.breakMinutes} min break` : ''}</span></p>
            <p className="muted">{[s.job, s.unit, s.client, s.location].filter(Boolean).join(' · ')}</p>
            {s.notes && <p>{s.notes}</p>}
            {s.state === 'updating' && <p className="muted">This shift is being changed. You’ll get the new details shortly.</p>}
            {(s.state === 'pending' || s.state === 'confirmed' || s.state === 'declined') && (
              declining === s.id ? (
                <div className="subform">
                  <label>What’s the reason? (optional)<input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. sick, family emergency" /></label>
                  <div className="row"><button className="btn danger" disabled={busy === s.id} onClick={() => respond(s, 'DECLINED')}>I can’t make this shift</button><button className="btn ghost" onClick={() => setDeclining(null)}>Back</button></div>
                </div>
              ) : (
                <div className="row">
                  {s.state !== 'confirmed' && <button className="btn" disabled={busy === s.id} onClick={() => respond(s, 'CONFIRMED')}>Confirm</button>}
                  {s.state !== 'declined' && <button className="btn ghost" disabled={busy === s.id} onClick={() => { setDeclining(s.id); setReason(''); }}>Can’t make it</button>}
                </div>
              )
            )}
          </li>
        ))}
      </ul>
      {data.contactEmail && <p className="muted">Questions? Email <a href={`mailto:${data.contactEmail}`}>{data.contactEmail}</a>.</p>}
    </main>
  );
}
