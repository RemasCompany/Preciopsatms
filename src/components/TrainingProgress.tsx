'use client';
import { useState } from 'react';
import { minutes } from '@/lib/training';

export type ProgressRow = {
  id: string; candidateId: string; name: string; courseId: string; status: string; lessonsDone: number; lessons: number;
  watchPct: number | null; watchSeconds: number; quizScore: number | null; attempts: number; lastActivity: string | null; watchingNow: boolean; assignedAt: string;
};
type Stage = 'not_started' | 'started' | 'finished' | 'passed' | 'certified' | 'failed';
const STAGES: { key: Stage; label: string; hint: string }[] = [
  { key: 'not_started', label: 'Not started', hint: 'Assigned, but no lesson or video opened yet' },
  { key: 'started', label: 'Started', hint: 'Working through the lessons and videos' },
  { key: 'finished', label: 'Finished lessons', hint: 'Every lesson done; quiz not passed yet' },
  { key: 'passed', label: 'Passed the quiz', hint: 'Waiting for the hands-on evaluation' },
  { key: 'certified', label: 'Certified', hint: 'Passed the evaluation' },
  { key: 'failed', label: 'Didn’t pass', hint: 'Didn’t pass the hands-on evaluation' },
];

export function stageOf(r: Pick<ProgressRow, 'status' | 'lessonsDone' | 'lessons' | 'watchSeconds' | 'attempts'>): Stage {
  if (r.status === 'certified') return 'certified';
  if (r.status === 'failed') return 'failed';
  if (r.status === 'evaluation') return 'passed';
  if (r.lessonsDone >= r.lessons) return 'finished';
  return r.lessonsDone > 0 || r.watchSeconds > 0 || r.attempts > 0 ? 'started' : 'not_started';
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

/** Per course: who hasn't started, who's working on it (and who's watching right now), who finished, who passed. */
export default function TrainingProgress({ courses, rows, open }: { courses: { id: string; title: string; minWatchPct: number }[]; rows: ProgressRow[]; open: (candidateId: string) => void }) {
  const withRows = courses.filter((c) => rows.some((r) => r.courseId === c.id));
  const [courseId, setCourseId] = useState(withRows[0]?.id ?? courses[0]?.id);
  const [stage, setStage] = useState<Stage | 'watching' | null>(null);
  const course = courses.find((c) => c.id === courseId);
  if (!course) return null;
  const mine = rows.filter((r) => r.courseId === course.id);
  const count = (s: Stage) => mine.filter((r) => stageOf(r) === s).length;
  const watching = mine.filter((r) => r.watchingNow).length;
  const shown = mine.filter((r) => (stage === 'watching' ? r.watchingNow : stage ? stageOf(r) === stage : true));
  const hasVideo = mine.some((r) => r.watchPct !== null);

  return (
    <section className="card" aria-label="Course progress"><h2 style={{ marginTop: 0 }}>Course progress</h2>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <label>Course<select value={course.id} onChange={(e) => { setCourseId(e.target.value); setStage(null); }}>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        {course.minWatchPct > 0 && <span className="muted">Workers must watch {course.minWatchPct}% of each video before the quiz.</span>}
      </div>
      {!mine.length ? <p className="muted">No one has been assigned this course yet.</p> : (
        <>
          <div className="kpis" style={{ marginTop: 8 }}>
            {STAGES.filter((s) => s.key !== 'failed' || count('failed')).map((s) => (
              <button key={s.key} type="button" className={`kpi${stage === s.key ? ' on' : ''}`} title={s.hint} aria-pressed={stage === s.key} onClick={() => setStage(stage === s.key ? null : s.key)} style={{ cursor: 'pointer', textAlign: 'left' }}>
                <b>{count(s.key)}</b><span>{s.label}</span></button>
            ))}
            <button type="button" className={`kpi${stage === 'watching' ? ' on' : ''}`} title="Played a video or opened a lesson in the last 15 minutes" aria-pressed={stage === 'watching'} onClick={() => setStage(stage === 'watching' ? null : 'watching')} style={{ cursor: 'pointer', textAlign: 'left' }}>
              <b>{watching}</b><span>Active now</span></button>
          </div>
          {stage && <p className="muted">Showing: {stage === 'watching' ? 'active in the last 15 minutes' : STAGES.find((s) => s.key === stage)!.label.toLowerCase()} · <button type="button" className="linkish" onClick={() => setStage(null)}>show everyone</button></p>}
          {!shown.length ? <p className="muted">No one here right now.</p> : (
            <div className="tablewrap"><table><thead><tr><th>Worker</th><th>Where they are</th><th>Lessons</th>{hasVideo && <th>Videos watched</th>}<th>Quiz</th><th>Last activity</th></tr></thead><tbody>
              {shown.map((r) => {
                const st = STAGES.find((s) => s.key === stageOf(r))!;
                return (
                  <tr key={r.id}>
                    <td><button className="link" onClick={() => open(r.candidateId)}><b>{r.name}</b></button></td>
                    <td><span className={`pill ${['certified', 'passed'].includes(st.key) ? 'g' : st.key === 'failed' ? 'r' : st.key === 'not_started' ? '' : 'a'}`}>{st.label}</span>{r.watchingNow && <span className="pill a" style={{ marginLeft: 4 }}>Active now</span>}</td>
                    <td>{r.lessonsDone} of {r.lessons}</td>
                    {hasVideo && <td>{r.watchPct === null ? '—' : <>{r.watchPct}%{r.watchSeconds ? <div className="muted">{minutes(r.watchSeconds)}</div> : null}</>}{course.minWatchPct > 0 && r.watchPct !== null && r.watchPct < course.minWatchPct && ['finished', 'passed', 'certified'].includes(st.key) && <div className="warn">Below {course.minWatchPct}%</div>}</td>}
                    <td>{r.attempts ? `${r.quizScore}% (${r.attempts} tr${r.attempts === 1 ? 'y' : 'ies'})` : '—'}</td>
                    <td>{when(r.lastActivity)}</td>
                  </tr>
                );
              })}
            </tbody></table></div>
          )}
        </>
      )}
    </section>
  );
}
