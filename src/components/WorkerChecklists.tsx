'use client';
import { useState } from 'react';
import { RATINGS } from '@/lib/skills-checklists';

export type WorkerChecklist = { id: string; title: string; sections: { title: string; items: string[] }[] };

/** Skills checklists on the worker's private page: rate each skill 1–4, sign, send. */
export default function WorkerChecklists({ token, items, onChange }: { token: string; items: WorkerChecklist[]; onChange: () => void }) {
  return (
    <section aria-label="Skills checklists">
      <h2 style={{ marginBottom: 4 }}>Skills checklist{items.length === 1 ? '' : 's'}</h2>
      {items.map((c) => <Checklist key={c.id} token={token} c={c} onChange={onChange} />)}
    </section>
  );
}

function Checklist({ token, c, onChange }: { token: string; c: WorkerChecklist; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const total = c.sections.reduce((n, s) => n + s.items.length, 0), done = Object.keys(answers).length;

  async function submit() {
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/public/checklists/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checklistId: c.id, answers, signedName: name, attest }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? 'That didn’t go through. Try again.'); return; }
      onChange();
    } catch { setError('Couldn’t connect. Check your signal and try again.'); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <b>{c.title}</b>
      <p className="muted">Rate your experience with each skill. {RATINGS.map((r) => `${r.value} = ${r.label}`).join('; ')}.</p>
      {!open ? <button className="btn" onClick={() => setOpen(true)}>Start ({total} skills)</button> : (
        <>
          {c.sections.map((sec, s) => (
            <fieldset key={s} style={{ border: 0, padding: 0, margin: '14px 0' }}>
              <legend><b>{sec.title}</b></legend>
              {sec.items.map((item, i) => {
                const k = `${s}.${i}`;
                return (
                  <div key={k} style={{ margin: '8px 0' }}>
                    <div>{item}</div>
                    <div className="row" role="radiogroup" aria-label={item} style={{ marginTop: 4, gap: 6 }}>
                      {RATINGS.map((r) => <button key={r.value} type="button" role="radio" aria-checked={answers[k] === r.value} title={r.label} className={`btn sm ${answers[k] === r.value ? '' : 'ghost'}`} onClick={() => setAnswers({ ...answers, [k]: r.value })}>{r.value}</button>)}
                    </div>
                  </div>
                );
              })}
            </fieldset>
          ))}
          <p className="muted">{done} of {total} rated</p>
          <label>Your full name (your signature)<input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
          <label className="check"><input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} /> My answers are an accurate picture of my experience.</label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn" disabled={busy || done < total || !name.trim() || !attest} onClick={submit}>{busy ? 'Sending…' : 'Send checklist'}</button>
        </>
      )}
    </div>
  );
}
