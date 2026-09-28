'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords } from './Records';

export type TaskRow = { id: string; title: string; dueAt: string | null; priority: string; related: string | null; done: boolean };
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const todayYmd = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10); };

export default function TaskList({ tasks: initial, showDone: showDoneProp }: { tasks: TaskRow[]; showDone: boolean }) {
  const router = useRouter();
  const { open, toast, canEdit } = useRecords();
  const [tasks, setTasks] = useState(initial);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDoneState] = useState(showDoneProp);
  useEffect(() => setTasks(initial), [initial]);
  useEffect(() => setShowDoneState(showDoneProp), [showDoneProp]);
  const today = todayYmd();

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const res = await fetch('/api/records/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, dueAt: due || null }) });
    setBusy(false);
    if (!res.ok) return toast((await res.json().catch(() => ({}))).error ?? 'Could not add the task.', true);
    setTitle(''); setDue(''); router.refresh();
  }
  async function toggle(t: TaskRow, done: boolean) {
    setTasks((xs) => xs.map((x) => (x.id === t.id ? { ...x, done } : x)));
    const res = await fetch(`/api/records/tasks/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done }) });
    if (!res.ok) { setTasks((xs) => xs.map((x) => (x.id === t.id ? { ...x, done: !done } : x))); toast('Could not update the task.', true); return; }
    router.refresh();
  }
  function setShowDone(on: boolean) {
    setShowDoneState(on);
    const u = new URL(window.location.href); if (on) u.searchParams.set('done', '1'); else u.searchParams.delete('done');
    router.replace(u.pathname + u.search);
  }

  return (
    <>
      <div className="bar">
        {canEdit && (
          <form className="row grow" onSubmit={add} style={{ margin: 0, flex: 1 }}>
            <input style={{ flex: 1, minWidth: 180 }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task and press Enter" aria-label="New task" required />
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
            <button className="btn" disabled={busy}>Add task</button>
          </form>
        )}
        <label className="check muted" style={{ margin: 0 }}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show completed</label>
      </div>
      <div className="card" style={{ marginTop: 0 }}>
        <div className="list">
          {tasks.map((t) => {
            const overdue = !t.done && t.dueAt !== null && t.dueAt < today;
            return (
              <div key={t.id} className="li">
                <label className="check" style={{ margin: 0, flex: 1, minWidth: 0, gap: 10, alignItems: 'center' }}>
                  <input type="checkbox" checked={t.done} disabled={!canEdit} onChange={(e) => toggle(t, e.target.checked)} aria-label={`Done: ${t.title}`} />
                  <span className="x" style={t.done ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                    <b style={{ color: 'var(--text)' }}>{t.title}</b>
                    <span className={overdue ? 'warn' : 'muted'}>{t.dueAt ? `${overdue ? 'Overdue · ' : t.dueAt === today ? 'Today · ' : ''}${fmt(t.dueAt)}` : 'No date'}{t.related ? ` · ${t.related}` : ''}{t.priority === 'High' ? ' · High priority' : ''}</span>
                  </span>
                </label>
                <button className="btn ghost sm" onClick={() => open('tasks', t.id)}>{canEdit ? 'Edit' : 'View'}</button>
              </div>
            );
          })}
          {!tasks.length && <p className="muted">{showDone ? 'No tasks yet.' : 'No open tasks.'}</p>}
        </div>
      </div>
    </>
  );
}
