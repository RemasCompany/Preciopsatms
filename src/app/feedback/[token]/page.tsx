'use client';
import { useEffect, useState } from 'react';
import { RATING_LABELS } from '@/lib/engagement';

type Info = { company: string; brandColor: string; worker: string; job: string; client: string | null; contact: string };

/** A client contact rates a worker from the one-time link in their email. */
export default function ClientFeedback({ params }: { params: { token: string } }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const [rating, setRating] = useState(0);
  const [rehire, setRehire] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch(`/api/public/feedback/${params.token}`).then(async (r) => { const j = await r.json(); if (r.ok) setInfo(j); else setError(j.error); }); }, [params.token]);
  async function send() {
    if (!rating) return setError('Choose a rating.');
    if (rehire === null) return setError('Tell us whether you’d have them back.');
    setBusy(true); setError('');
    const r = await fetch(`/api/public/feedback/${params.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating, wouldRehire: rehire, comment }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) setDone(true); else setError(j.error ?? 'That didn’t go through. Try again.');
  }
  if (done) return <main className="public"><h1>Thank you!</h1><p>Your feedback on {info?.worker.split(' ')[0]} has been sent to {info?.company}.</p></main>;
  if (!info) return <main className="public"><p className={error ? 'error' : 'muted'}>{error || 'Loading…'}</p></main>;
  const first = info.worker.split(' ')[0];
  return (
    <main className="public" style={{ ['--accent' as string]: info.brandColor }}>
      <p className="muted" style={{ margin: 0 }}>{info.company}</p>
      <h1>How is {info.worker} doing?</h1>
      <p className="lede">{info.job}{info.client ? ` at ${info.client}` : ''}. Hi {info.contact.split(' ')[0]} — this takes 30 seconds.</p>
      <div className="card">
        <p style={{ marginTop: 0 }}><b>Overall work</b></p>
        <div className="stars" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} — ${RATING_LABELS[n]}`} className={n <= rating ? 'on' : undefined} onClick={() => setRating(n)}>★</button>)}
          {rating > 0 && <span className="muted">{RATING_LABELS[rating]}</span>}
        </div>
        <p><b>Would you have {first} back?</b></p>
        <div className="row" role="radiogroup" aria-label="Would you have them back">
          <button type="button" className={`btn ${rehire === true ? '' : 'ghost'}`} aria-pressed={rehire === true} onClick={() => setRehire(true)}>Yes</button>
          <button type="button" className={`btn ${rehire === false ? 'danger' : 'ghost'}`} aria-pressed={rehire === false} onClick={() => setRehire(false)}>No</button>
        </div>
        <label><span>Anything we should know? (optional)</span><textarea rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send feedback'}</button>
      </div>
    </main>
  );
}
