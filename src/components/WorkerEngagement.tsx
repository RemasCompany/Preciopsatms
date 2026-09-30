'use client';
import { useState } from 'react';
import { RECOGNITION_KINDS, WORKER_FACES, RATING_LABELS, type RecognitionKind } from '@/lib/engagement';

export type WorkerEng = { onAssignment: boolean; askPulse: boolean; birthdaySet: boolean; recognitions: { id: string; kind: string; message: string; createdAt: string }[] };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** On the worker's page: recognition they've received, a quick "how's it going?" and an optional birthday. */
export default function WorkerEngagement({ token, data, onChange }: { token: string; data: WorkerEng; onChange: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [month, setMonth] = useState(0);
  const [day, setDay] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  async function post(body: object) {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/public/engagement/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? { text: j.message } : { text: j.error ?? 'That didn’t go through. Try again.', bad: true });
    if (r.ok) onChange();
  }
  const kudos = data.recognitions;
  return <>
    {kudos.length > 0 && (
      <section className="card kudos">
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Your recognition</h2>
        <ul>{kudos.map((k) => { const kind = RECOGNITION_KINDS[k.kind as RecognitionKind] ?? RECOGNITION_KINDS.other; return (
          <li key={k.id}><span className="kemoji" aria-hidden="true">{kind.emoji}</span><div><b>{kind.label}</b><p>{k.message}</p><span className="muted">{new Date(k.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></div></li>
        ); })}</ul>
      </section>
    )}
    {data.askPulse && (
      <section className="card pulse">
        <h2 style={{ marginTop: 0, fontSize: 17 }}>How’s your assignment going?</h2>
        <div className="faces" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={RATING_LABELS[n]} className={rating === n ? 'on' : undefined} onClick={() => setRating(n)}>{WORKER_FACES[n]}</button>)}
        </div>
        {rating > 0 && <>
          <label><span>{rating <= 2 ? 'What’s wrong? Your recruiter will follow up.' : 'Anything to share? (optional)'}</span><textarea rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
          <button className="btn" disabled={busy} onClick={() => post({ action: 'pulse', rating, comment })}>Send</button>
        </>}
      </section>
    )}
    {data.onAssignment && !data.birthdaySet && (
      <section className="card">
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Want us to celebrate your birthday? 🎂</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>Optional. Just the month and day — never the year.</p>
        <div className="row" style={{ marginTop: 0 }}>
          <select aria-label="Month" value={month} onChange={(e) => setMonth(Number(e.target.value))}><option value={0}>Month</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          <select aria-label="Day" value={day} onChange={(e) => setDay(Number(e.target.value))}><option value={0}>Day</option>{Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select>
          <button className="btn ghost" disabled={busy || !month || !day} onClick={() => post({ action: 'birthday', month, day })}>Save</button>
        </div>
      </section>
    )}
    {msg && <p className={`card banner ${msg.bad ? 'error' : ''}`} role="status">{msg.text}</p>}
  </>;
}
