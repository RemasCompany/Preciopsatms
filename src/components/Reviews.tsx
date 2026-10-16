'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Drawer from './Drawer';
import { useRecords } from './Records';
import ReviewAnswers, { RATING, type Answers, type Question } from './ReviewAnswers';
import { fmtDate } from '@/lib/people-shared';
import ReviewSchedule, { type Schedule, type Upcoming } from './ReviewSchedule';

export type CycleRow = { id: string; name: string; status: 'OPEN' | 'CLOSED'; selfReview: boolean; periodStart: string; periodEnd: string; dueDate: string; total: number; self: number; manager: number; shared: number; acknowledged: number };
export type ReviewRow = { id: string; employeeId: string; name: string; title: string; department: string | null; manager: string | null; self: boolean; managerDraft: boolean; manager_: boolean; shared: boolean; acknowledged: boolean; rating: number | null; goals: number; due: string };
type Goal = { id: string; title: string; details: string | null; dueDate: string | null; progress: number; status: 'OPEN' | 'DONE' | 'DROPPED' };
type Detail = {
  id: string; employeeId: string; employee: string; title: string; cycle: { id: string; name: string; status: string; selfReview: boolean; questions: Question[]; dueDate: string };
  self: Answers | null; selfSubmittedAt: string | null; manager: Answers | null; rating: number | null; summary: string | null; managerSubmittedAt: string | null;
  sharedAt: string | null; acknowledgedAt: string | null; employeeComment: string | null; goals: Goal[];
};

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Try again.');
  return json;
}
const stage = (r: ReviewRow, selfReview: boolean): [string, string] =>
  r.acknowledged ? ['Acknowledged', 'g'] : r.shared ? ['Shared, not yet read', 'a'] : r.manager_ ? ['Ready to share', 'a'] : r.managerDraft ? ['Manager review started', ''] : selfReview && !r.self ? ['Waiting for self review', ''] : ['Ready for manager review', 'a'];

export default function Reviews({ cycles, current, rows, departments, defaults, canEdit, admin, today, schedule, upcoming }: {
  cycles: CycleRow[]; current: string | null; rows: ReviewRow[]; departments: { id: string; name: string }[]; defaults: { text: string; kind: 'rating' | 'text' }[]; canEdit: boolean; admin: boolean; today: string;
  schedule: Schedule; upcoming: Upcoming[];
}) {
  const router = useRouter();
  const { toast } = useRecords();
  const [starting, setStarting] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const cycle = cycles.find((c) => c.id === current) ?? null;
  const act = async (fn: () => Promise<string>) => { try { toast(await fn()); router.refresh(); } catch (e) { toast((e as Error).message, true); } };

  return (
    <>
      <ReviewSchedule schedule={schedule} upcoming={upcoming} admin={admin} onOpen={setOpen} />
      <div className="bar">
        {cycles.length > 1 && <select aria-label="Review cycle" value={current ?? ''} onChange={(e) => router.push(`?cycle=${e.target.value}`)}>{cycles.map((c) => <option key={c.id} value={c.id}>{c.name}{c.status === 'CLOSED' ? ' (closed)' : ''}</option>)}</select>}
        <span className="grow" />
        {admin && cycle?.status === 'OPEN' && <button className="btn ghost" onClick={() => act(async () => { const r = await api(`/api/reviews/cycles/${cycle.id}`, 'PATCH', { addMissing: true }); return r.added ? `Added ${r.added} employee${r.added === 1 ? '' : 's'}.` : 'Everyone is already in this cycle.'; })}>Add new employees</button>}
        {admin && cycle && <button className="btn ghost" onClick={() => { if (cycle.status === 'OPEN' && !confirm(`Close ${cycle.name}? Nobody can change reviews until it’s reopened.`)) return; act(async () => { await api(`/api/reviews/cycles/${cycle.id}`, 'PATCH', { status: cycle.status === 'OPEN' ? 'CLOSED' : 'OPEN' }); return cycle.status === 'OPEN' ? 'Cycle closed.' : 'Cycle reopened.'; }); }}>{cycle.status === 'OPEN' ? 'Close cycle' : 'Reopen cycle'}</button>}
        {admin && <button className="btn" onClick={() => setStarting(true)}>+ Start a review cycle</button>}
      </div>

      {!cycle ? (
        <div className="card empty"><b>No review cycles yet</b>{admin ? 'Start one for everyone, or one department. Employees fill in their self review from their employee page.' : 'An owner or admin starts review cycles.'}</div>
      ) : <>
        <div className="kpis">
          <div className="kpi"><b>{cycle.total}</b><span>In {cycle.name}</span></div>
          {cycle.selfReview && <div className="kpi"><b>{cycle.self}</b><span>Self reviews in</span></div>}
          <div className="kpi"><b>{cycle.manager}</b><span>Manager reviews done</span></div>
          <div className="kpi"><b>{cycle.acknowledged}</b><span>Acknowledged</span></div>
          <div className="kpi"><b className={cycle.status === 'OPEN' && cycle.dueDate < today && cycle.manager < cycle.total ? 'warnnum' : undefined}>{fmtDate(cycle.dueDate)}</b><span>Due{cycle.status === 'CLOSED' ? ' (closed)' : ''}</span></div>
        </div>
        {rows.length ? (
          <div className="tablewrap"><table>
            <thead><tr><th>Employee</th><th>Manager</th><th>Due</th><th>Status</th><th>Rating</th><th>Open goals</th></tr></thead>
            <tbody>{rows.map((r) => { const [label, pill] = stage(r, cycle.selfReview); return (
              <tr key={r.id} className="clickrow" tabIndex={0} onClick={() => setOpen(r.id)} onKeyDown={(k) => k.key === 'Enter' && setOpen(r.id)}>
                <td><b>{r.name}</b><div className="muted">{r.title}{r.department ? ` · ${r.department}` : ''}</div></td>
                <td>{r.manager ?? <span className="muted">—</span>}</td>
                <td className={cycle.status === 'OPEN' && !r.manager_ && r.due < today ? 'warnnum' : undefined}>{fmtDate(r.due)}{cycle.status === 'OPEN' && !r.manager_ && r.due < today && <div style={{ fontSize: 12 }}>Overdue</div>}</td>
                <td><span className={`pill ${pill}`}>{label}</span>{cycle.selfReview && r.self && !r.shared && <div className="muted">Self review in</div>}</td>
                <td>{r.rating ? `${r.rating} · ${RATING[r.rating]}` : <span className="muted">—</span>}</td>
                <td>{r.goals || <span className="muted">0</span>}</td>
              </tr>
            ); })}</tbody>
          </table></div>
        ) : <div className="card empty"><b>No one in this cycle</b>Use “Add new employees” to include current employees.</div>}
      </>}

      {starting && <StartCycle departments={departments} defaults={defaults} onClose={() => setStarting(false)} onDone={(id) => { setStarting(false); router.push(`?cycle=${id}`); router.refresh(); }} />}
      {open && <ReviewDrawer id={open} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={() => router.refresh()} />}
    </>
  );
}

function StartCycle({ departments, defaults, onClose, onDone }: { departments: { id: string; name: string }[]; defaults: { text: string; kind: 'rating' | 'text' }[]; onClose: () => void; onDone: (id: string) => void }) {
  const { toast } = useRecords();
  const y = new Date().getFullYear();
  const [v, setV] = useState({ name: `${y} annual review`, periodStart: `${y}-01-01`, periodEnd: `${y}-12-31`, dueDate: new Date(Date.now() + 21 * 864e5).toLocaleDateString('en-CA'), selfReview: true, departmentId: '' });
  const [qs, setQs] = useState(defaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    try { const r = await api('/api/reviews/cycles', 'POST', { ...v, departmentId: v.departmentId || null, questions: qs }); toast(`Started with ${r.added} employee${r.added === 1 ? '' : 's'}.`); onDone(r.id); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Start a review cycle" onClose={onClose} footer={<><button className="btn" onClick={save} disabled={busy}>Start cycle</button><button className="btn ghost" onClick={onClose}>Cancel</button></>}>
      <div className="form">
        <label className="full"><span>Name</span><input value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
        <label><span>Period from</span><input type="date" value={v.periodStart} onChange={(e) => setV({ ...v, periodStart: e.target.value })} /></label>
        <label><span>Period to</span><input type="date" value={v.periodEnd} onChange={(e) => setV({ ...v, periodEnd: e.target.value })} /></label>
        <label><span>Due</span><input type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} /></label>
        <label><span>Who</span><select value={v.departmentId} onChange={(e) => setV({ ...v, departmentId: e.target.value })}><option value="">Everyone</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label className="check full"><input type="checkbox" checked={v.selfReview} onChange={(e) => setV({ ...v, selfReview: e.target.checked })} /> Ask employees for a self review first</label>
      </div>
      <h3 className="previewh">Questions</h3>
      {qs.map((q, i) => (
        <div key={i} className="row" style={{ marginBottom: 6 }}>
          <input value={q.text} maxLength={200} aria-label={`Question ${i + 1}`} style={{ flex: 1 }} onChange={(e) => setQs(qs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
          <select value={q.kind} aria-label={`Question ${i + 1} type`} onChange={(e) => setQs(qs.map((x, j) => (j === i ? { ...x, kind: e.target.value as 'rating' | 'text' } : x)))}><option value="rating">1–5 rating</option><option value="text">Written</option></select>
          <button className="btn ghost sm" aria-label={`Remove question ${i + 1}`} onClick={() => setQs(qs.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      {qs.length < 15 && <button className="btn ghost sm" onClick={() => setQs([...qs, { text: '', kind: 'text' }])}>+ Add question</button>}
      {error && <p className="error" role="alert">{error}</p>}
    </Drawer>
  );
}

function ReviewDrawer({ id, canEdit, onClose, onChanged }: { id: string; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const { toast } = useRecords();
  const [d, setD] = useState<Detail | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [rating, setRating] = useState<number | null>(null);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [goal, setGoal] = useState<Partial<Goal> | null>(null);
  const load = useCallback(async () => {
    try { const r: Detail = await api(`/api/reviews/${id}`, 'GET'); setD(r); setAnswers(r.manager ?? {}); setRating(r.rating); setSummary(r.summary ?? ''); }
    catch (e) { toast((e as Error).message, true); onClose(); }
  }, [id, toast, onClose]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Drawer title="Loading…" onClose={onClose}><p className="muted">Loading…</p></Drawer>;
  const locked = !canEdit || !!d.sharedAt || d.cycle.status !== 'OPEN';
  const run = async (fn: () => Promise<string>) => { setBusy(true); setError(''); try { toast(await fn()); await load(); onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const save = (submit: boolean) => run(async () => { await api(`/api/reviews/${id}`, 'PUT', { answers, rating, summary, submit }); return submit ? 'Submitted. Share it when you’re ready.' : 'Draft saved.'; });

  return (
    <Drawer title={d.employee} kicker={`${d.cycle.name} · ${d.title}`} onClose={onClose} footer={!locked ? <>
      {!d.managerSubmittedAt ? <><button className="btn" onClick={() => save(true)} disabled={busy}>Submit review</button><button className="btn ghost" onClick={() => save(false)} disabled={busy}>Save draft</button></>
        : <><button className="btn" disabled={busy} onClick={() => run(async () => { await api(`/api/reviews/${id}`, 'POST'); return `Shared. ${d.employee} sees it on their employee page.`; })}>Share with {d.employee.split(' ')[0]}</button><button className="btn ghost" onClick={() => save(false)} disabled={busy}>Save changes</button></>}
    </> : undefined}>
      {d.cycle.selfReview && (
        <section className="sec"><h3>Self review</h3>
          {d.self ? <ReviewAnswers name="self" questions={d.cycle.questions} answers={d.self} /> : <p className="muted">Not submitted yet{d.cycle.status === 'OPEN' ? ` — due ${fmtDate(d.cycle.dueDate)}. They fill it in on their employee page.` : '.'}</p>}
        </section>
      )}
      <section className="sec"><h3>Manager review</h3>
        <ReviewAnswers name="mgr" questions={d.cycle.questions} answers={answers} onChange={locked ? undefined : setAnswers} />
        <div className="rq"><b>Overall rating</b>
          <div className="ratingrow" role="radiogroup" aria-label="Overall rating">{[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className={`rate${rating === n ? ' on' : ''}`} title={RATING[n]}><input type="radio" name="overall" checked={rating === n} disabled={locked} onChange={() => setRating(n)} /><span>{n}</span></label>
          ))}<span className="muted">{rating ? RATING[rating] : 'Choose 1–5'}</span></div></div>
        <label className="full" style={{ marginTop: 10 }}><span>Summary for the employee</span><textarea rows={3} maxLength={3000} value={summary} readOnly={locked} onChange={(e) => setSummary(e.target.value)} /></label>
        {d.sharedAt && <p className="muted">Shared {fmtDate(d.sharedAt.slice(0, 10))}. {d.acknowledgedAt ? `Acknowledged ${fmtDate(d.acknowledgedAt.slice(0, 10))}${d.employeeComment ? `: “${d.employeeComment}”` : '.'}` : 'Not acknowledged yet.'}</p>}
      </section>
      <section className="sec"><h3>Goals {canEdit && <button className="btn ghost sm" onClick={() => setGoal({})}>+ Add goal</button>}</h3>
        {d.goals.length ? <div className="list">{d.goals.map((g) => (
          <div key={g.id} className="li"><div className="x"><b>{g.title}</b><span className="muted">{g.status === 'OPEN' ? `${g.progress}%` : g.status === 'DONE' ? 'Done' : 'Dropped'}{g.dueDate ? ` · by ${fmtDate(g.dueDate)}` : ''}</span><div className="progress"><i style={{ width: `${g.progress}%` }} /></div></div>
            {canEdit && <button className="btn ghost sm" onClick={() => setGoal(g)}>Edit</button>}</div>
        ))}</div> : <p className="muted">No goals yet. Goals show on their employee page, where they can update progress.</p>}
        {goal && <GoalForm g={goal} busy={busy} onCancel={() => setGoal(null)} onSave={(b) => run(async () => { if (goal.id) await api(`/api/goals/${goal.id}`, 'PATCH', b); else await api('/api/goals', 'POST', { ...b, employeeId: d.employeeId }); setGoal(null); return 'Goal saved.'; })} />}
      </section>
      {error && <p className="error" role="alert">{error}</p>}
    </Drawer>
  );
}

function GoalForm({ g, busy, onCancel, onSave }: { g: Partial<Goal>; busy: boolean; onCancel: () => void; onSave: (b: object) => void }) {
  const [v, setV] = useState({ title: g.title ?? '', details: g.details ?? '', dueDate: g.dueDate ?? '', progress: g.progress ?? 0, status: g.status ?? 'OPEN' });
  return (
    <div className="card" style={{ marginTop: 10 }}>
      <div className="form">
        <label className="full"><span>Goal</span><input value={v.title} maxLength={200} placeholder="e.g. Get certified on the reach truck" onChange={(e) => setV({ ...v, title: e.target.value })} /></label>
        <label className="full"><span>Details</span><textarea rows={2} maxLength={2000} value={v.details} onChange={(e) => setV({ ...v, details: e.target.value })} /></label>
        <label><span>By</span><input type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} /></label>
        {g.id && <label><span>Status</span><select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as Goal['status'] })}><option value="OPEN">Open</option><option value="DONE">Done</option><option value="DROPPED">Dropped</option></select></label>}
      </div>
      <div className="row"><button className="btn sm" disabled={busy} onClick={() => onSave({ title: v.title, details: v.details || null, dueDate: v.dueDate || null, ...(g.id ? { status: v.status } : {}) })}>Save goal</button><button className="btn ghost sm" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}
