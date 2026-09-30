'use client';
import { useState } from 'react';

type Turn = { q: string; a: string };
const SUGGESTIONS = ['What needs my attention today?', 'Which open jobs have been open longest, and how is their pipeline?', 'How many people did we place last month, and from which sources?'];
const ADMIN_SUGGESTIONS = ['Which client had the best margin last month?', 'How much do clients owe us, and how much is past due?'];

export default function Assistant({ admin, credits: initial }: { admin: boolean; credits: number }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [credits, setCredits] = useState(initial);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, history: turns.slice(-4) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? 'The assistant couldn’t answer. Try again.'); return; }
      setTurns((t) => [...t, { q: question, a: j.answer }]); setQ(''); setCredits((c) => Math.max(0, c - 1));
    } catch { setError('Couldn’t reach the server. Check your connection and try again.'); }
    finally { setBusy(false); }
  }

  return (
    <section className="card">
      {turns.length === 0 && (
        <div>
          <p className="muted">Try one of these:</p>
          <p>{[...SUGGESTIONS, ...(admin ? ADMIN_SUGGESTIONS : [])].map((s) => <button key={s} type="button" className="ghost" style={{ margin: '0 8px 8px 0' }} disabled={busy || !credits} onClick={() => ask(s)}>{s}</button>)}</p>
        </div>
      )}
      {turns.map((t, i) => (
        <div key={i} style={{ marginBottom: 16 }}>
          <p><b>You:</b> {t.q}</p>
          <div style={{ whiteSpace: 'pre-wrap' }}>{t.a}</div>
        </div>
      ))}
      {busy && <p className="muted" aria-live="polite">Looking that up…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <label><span>Your question</span><textarea rows={2} maxLength={1000} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. How many timesheets are waiting for approval?"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(q); } }} /></label>
        <button disabled={busy || !q.trim() || !credits}>{busy ? 'Asking…' : 'Ask'}</button>
        {turns.length > 0 && <button type="button" className="ghost" style={{ marginLeft: 8 }} onClick={() => { setTurns([]); setError(''); }}>New conversation</button>}
        <span className="muted" style={{ marginLeft: 12 }}>{credits ? `${credits} AI credit${credits === 1 ? '' : 's'} left this period; each question uses one.` : 'You’ve used all AI credits for this period.'}</span>
      </form>
    </section>
  );
}
