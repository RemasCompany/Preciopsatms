'use client';

export type Question = { id: string; text: string; kind: 'rating' | 'text' };
export type Answers = Record<string, { rating?: number; text?: string }>;
export const RATING = ['', 'Needs improvement', 'Developing', 'Meets expectations', 'Exceeds expectations', 'Outstanding'];

/** One review's questions: 1–5 ratings and written answers. Read-only when `onChange` is missing. */
export default function ReviewAnswers({ questions, answers, onChange, name }: { questions: Question[]; answers: Answers | null; onChange?: (a: Answers) => void; name: string }) {
  const a = answers ?? {};
  const set = (id: string, v: { rating?: number; text?: string }) => onChange?.({ ...a, [id]: v });
  return (
    <div className="reviewqs">
      {questions.map((q) => (
        <div key={q.id} className="rq">
          <b>{q.text}</b>
          {q.kind === 'rating' ? (
            <div className="ratingrow" role="radiogroup" aria-label={q.text}>
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className={`rate${a[q.id]?.rating === n ? ' on' : ''}`} title={RATING[n]}>
                  <input type="radio" name={`${name}-${q.id}`} value={n} checked={a[q.id]?.rating === n} disabled={!onChange} onChange={() => set(q.id, { rating: n })} />
                  <span>{n}</span>
                </label>
              ))}
              <span className="muted">{a[q.id]?.rating ? RATING[a[q.id]!.rating!] : onChange ? 'Choose 1–5' : 'Not rated'}</span>
            </div>
          ) : onChange ? (
            <textarea rows={3} maxLength={3000} value={a[q.id]?.text ?? ''} aria-label={q.text} onChange={(e) => set(q.id, { text: e.target.value })} />
          ) : <p className="answer">{a[q.id]?.text ?? <span className="muted">No answer</span>}</p>}
        </div>
      ))}
    </div>
  );
}
