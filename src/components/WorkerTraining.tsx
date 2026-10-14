'use client';
import { useState } from 'react';

export type WorkerCourse = {
  id: string; title: string; description: string | null; status: 'assigned' | 'evaluation' | 'certified' | 'failed' | 'cancelled'; reason: string; dueDate: string | null;
  passScore: number; quizScore: number | null; attempts: number; lessons: { title: string; body: string; videoUrl: string | null }[]; lessonsDone: number[];
  questions: { q: string; choices: string[] }[]; expiresAt: string | null; certType: string;
};
const fmt = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Training on the worker's private page: read each lesson, then take the quiz. Grading happens on the server. */
export default function WorkerTraining({ token, items, onChange }: { token: string; items: WorkerCourse[]; onChange: () => void }) {
  return (
    <section aria-label="Training">
      <h2 style={{ marginBottom: 4 }}>Training</h2>
      {items.map((c) => <Course key={c.id} token={token} c={c} onChange={onChange} />)}
    </section>
  );
}

function Course({ token, c, onChange }: { token: string; c: WorkerCourse; onChange: () => void }) {
  const [open, setOpen] = useState<number | 'quiz' | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>(() => c.questions.map(() => null));
  const [result, setResult] = useState<{ score: number; passed: boolean; wrong: number[] } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const post = async (body: object) => {
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/public/training/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enrollmentId: c.id, ...body }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? 'That didn’t go through. Try again.'); return null; }
      return j;
    } catch { setError('Couldn’t connect. Check your signal and try again.'); return null; } finally { setBusy(false); }
  };
  const allRead = c.lessonsDone.length >= c.lessons.length;

  if (c.status === 'certified') return <div className="card"><b>{c.title}</b><p className="pill g" style={{ display: 'inline-block' }}>Certified</p><p>You’re certified: {c.certType}{c.expiresAt ? `, until ${fmt(c.expiresAt)}` : ''}.</p></div>;
  if (c.status === 'evaluation') return <div className="card"><b>{c.title}</b><p>You passed the quiz{c.quizScore !== null ? ` (${c.quizScore}%)` : ''}. Next, a trainer will meet you for hands-on practice and an evaluation on the equipment. You’re not certified until that’s done.</p></div>;

  return (
    <div className="card">
      <b>{c.title}</b>{c.reason === 'refresher' && <span className="pill a" style={{ marginLeft: 8 }}>Refresher</span>}
      {c.description && <p className="muted">{c.description}</p>}
      {c.dueDate && <p className="muted">Please finish by {fmt(c.dueDate)}.</p>}
      <ol className="list" style={{ paddingLeft: 18 }}>
        {c.lessons.map((l, i) => (
          <li key={i} style={{ marginBottom: 8 }}>
            <button className="link" onClick={() => setOpen(open === i ? null : i)}>{l.title}</button> {c.lessonsDone.includes(i) && <span className="pill g">Read</span>}
            {open === i && (
              <div className="subform">
                <div style={{ whiteSpace: 'pre-wrap' }}>{l.body}</div>
                {l.videoUrl && /^https:\/\//.test(l.videoUrl) && <p><a href={l.videoUrl} target="_blank" rel="noreferrer">Watch the video</a></p>}
                {!c.lessonsDone.includes(i) && <button className="btn" disabled={busy} onClick={async () => { if (await post({ lesson: i })) { setOpen(i + 1 < c.lessons.length ? i + 1 : null); onChange(); } }}>I’ve read this</button>}
              </div>
            )}
          </li>
        ))}
      </ol>
      {open !== 'quiz' ? (
        <button className="btn" disabled={!allRead} onClick={() => { setOpen('quiz'); setResult(null); }}>{allRead ? (c.attempts ? 'Retake the quiz' : 'Take the quiz') : `Read all ${c.lessons.length} lessons to take the quiz`}</button>
      ) : (
        <div className="subform">
          <p className="muted">{c.questions.length} questions. You need {c.passScore}% to pass.</p>
          {c.questions.map((q, i) => (
            <fieldset key={i} style={result?.wrong.includes(i) ? { borderColor: 'var(--danger, #c33)' } : undefined}>
              <legend>{i + 1}. {q.q}</legend>
              {q.choices.map((ch, j) => <label key={j} className="check"><input type="radio" name={`${c.id}-${i}`} checked={answers[i] === j} onChange={() => setAnswers(answers.map((a, k) => (k === i ? j : a)))} /> {ch}</label>)}
              {result?.wrong.includes(i) && <p className="error">Not quite. Review the lessons and try again.</p>}
            </fieldset>
          ))}
          {result && !result.passed && <p className="error" role="alert">You scored {result.score}%. You need {c.passScore}% — re-read the lessons and try again.</p>}
          <button className="btn" disabled={busy || answers.some((a) => a === null)} onClick={async () => {
            const r = await post({ answers });
            if (!r) return;
            setResult(r);
            if (r.passed) onChange();
          }}>{busy ? 'Checking…' : 'Submit answers'}</button>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
