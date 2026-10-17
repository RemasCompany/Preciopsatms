'use client';
import { ASSISTANT_NAME } from '@/lib/assistant-name';
import { useState } from 'react';

type Turn = { q: string; a: string };
type Mode = 'business' | 'coach';
const SUGGESTIONS = ['What needs my attention today?', 'Which open jobs have been open longest, and how is their pipeline?', 'How many people did we place last month, and from which sources?'];
const ADMIN_SUGGESTIONS = ['Which client had the best margin last month?', 'How much do clients owe us, and how much is past due?'];
const COACH_SUGGESTIONS = [
  'Two people on my team keep clashing over shift handoffs. How do I mediate?',
  'How do I coach someone who is often 10–15 minutes late?',
  'How do I give hard feedback to a strong performer whose attitude is hurting the team?',
  'A worker says a coworker keeps making comments about their religion. What should I do?',
  'A client supervisor says our worker is too slow and wants them replaced. How should I handle it?',
];
const PLACEHOLDER = { business: 'e.g. How many timesheets are waiting for approval?', coach: 'Describe the situation: what happened, who’s involved, how long it’s been going on, and what you’ve tried.' };

export default function Assistant({ admin, credits: initial }: { admin: boolean; credits: number }) {
  const [mode, setMode] = useState<Mode>('business');
  const [turns, setTurns] = useState<Record<Mode, Turn[]>>({ business: [], coach: [] });
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [credits, setCredits] = useState(initial);
  const list = turns[mode];

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, history: list.slice(-4), mode }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? `${ASSISTANT_NAME} couldn’t answer. Try again.`); return; }
      setTurns((t) => ({ ...t, [mode]: [...t[mode], { q: question, a: j.answer }] })); setQ(''); setCredits((c) => Math.max(0, c - 1));
    } catch { setError('Couldn’t reach the server. Check your connection and try again.'); }
    finally { setBusy(false); }
  }
  const suggestions = mode === 'coach' ? COACH_SUGGESTIONS : [...SUGGESTIONS, ...(admin ? ADMIN_SUGGESTIONS : [])];

  return (
    <section className="card">
      <div className="row" role="tablist" aria-label="What you need" style={{ marginTop: 0 }}>
        {([['business', 'Your business'], ['coach', 'Manager coaching']] as const).map(([m, l]) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={`btn sm ${mode === m ? '' : 'ghost'}`} onClick={() => { setMode(m); setError(''); }}>{l}</button>
        ))}
      </div>
      {mode === 'coach' && (
        <p className="muted" style={{ fontSize: 13 }}>
          Advice for people issues: conflict between team members, performance or attendance, coaching, hard conversations and discipline. Names of your workers and team are replaced with “Person A”, “Person B” before anything is sent to the AI, and conversations aren’t saved.
          Anything involving harassment, discrimination, safety, injuries, medical leave or a possible firing goes to HR or your employment lawyer as well. This is guidance, not legal advice.
        </p>
      )}
      {list.length === 0 && (
        <div>
          <p className="muted">Try one of these:</p>
          <p>{suggestions.map((s) => <button key={s} type="button" className="ghost" style={{ margin: '0 8px 8px 0' }} disabled={busy || !credits} onClick={() => ask(s)}>{s}</button>)}</p>
        </div>
      )}
      {list.map((t, i) => (
        <div key={i} style={{ marginBottom: 16 }}>
          <p><b>You:</b> {t.q}</p>
          <div style={{ whiteSpace: 'pre-wrap' }}><b>{ASSISTANT_NAME}:</b> {t.a}</div>
        </div>
      ))}
      {busy && <p className="muted" aria-live="polite">{ASSISTANT_NAME} is {mode === 'coach' ? 'thinking it through' : 'looking that up'}…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <label><span>{mode === 'coach' ? 'What’s going on?' : 'Your question'}</span><textarea rows={mode === 'coach' ? 4 : 2} maxLength={1000} value={q} onChange={(e) => setQ(e.target.value)} placeholder={PLACEHOLDER[mode]}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(q); } }} /></label>
        <button disabled={busy || !q.trim() || !credits}>{busy ? 'Asking…' : 'Ask'}</button>
        {list.length > 0 && <button type="button" className="ghost" style={{ marginLeft: 8 }} onClick={() => { setTurns((t) => ({ ...t, [mode]: [] })); setError(''); }}>New conversation</button>}
        <span className="muted" style={{ marginLeft: 12 }}>{credits ? `${credits} AI credit${credits === 1 ? '' : 's'} left this period; each question uses one.` : 'You’ve used all AI credits for this period.'}</span>
      </form>
    </section>
  );
}
