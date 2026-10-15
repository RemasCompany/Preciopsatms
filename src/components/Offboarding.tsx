'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Drawer from './Drawer';
import { useRecords } from './Records';
import { fmtDate } from '@/lib/people-shared';
import type { TemplateItem } from '@/lib/offboarding';

type Task = { id: string; title: string; owner: string | null; dueDate: string | null; done: boolean; note: string | null };
export type Leaver = { id: string; candidateId: string; name: string; title: string; department: string | null; lastDay: string; reason: string | null; status: string; tasks: Task[] };

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Try again.');
  return json;
}

export default function Offboarding({ leavers, template, all, canEdit, admin, today }: { leavers: Leaver[]; template: TemplateItem[]; all: boolean; canEdit: boolean; admin: boolean; today: string }) {
  const router = useRouter();
  const { toast, open } = useRecords();
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<Record<string, string>>({});
  // Ticks show right away; the page catches up when it refreshes (and a failed save puts it back).
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const isDone = (t: Task) => ticked[t.id] ?? t.done;
  const act = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); if (msg) toast(msg); router.refresh(); } catch (e) { toast((e as Error).message, true); } };

  return (
    <>
      <div className="bar">
        <Link className="btn ghost sm" href={all ? '?' : '?show=all'}>{all ? 'Recent only' : 'Show everyone'}</Link>
        <span className="grow" />
        {admin && <button className="btn ghost" onClick={() => setEditing(true)}>Edit checklist</button>}
      </div>
      {!leavers.length ? <div className="card empty"><b>No one is leaving</b>End someone’s employment on the Employees page and their checklist starts here.</div> : leavers.map((l) => {
        const done = l.tasks.filter(isDone).length;
        return (
          <section key={l.id} className="card offcard">
            <div className="offhead">
              <div><h2 style={{ margin: 0 }}>{l.name}</h2><span className="muted">{l.title}{l.department ? ` · ${l.department}` : ''} · {l.lastDay > today ? 'last day' : 'left'} {fmtDate(l.lastDay)}{l.reason ? ` · ${l.reason}` : ''}</span></div>
              <span className={`pill ${done === l.tasks.length ? 'g' : 'a'}`}>{done} of {l.tasks.length} done</span>
            </div>
            <div className="progress"><i style={{ width: `${l.tasks.length ? (done / l.tasks.length) * 100 : 0}%` }} /></div>
            <ul className="checklist">{l.tasks.map((t) => (
              <li key={t.id} className={isDone(t) ? 'done' : t.dueDate && t.dueDate < today ? 'late' : ''}>
                <label className="check"><input type="checkbox" checked={isDone(t)} disabled={!canEdit} onChange={(e) => { const on = e.target.checked; setTicked((x) => ({ ...x, [t.id]: on })); act(() => api(`/api/offboarding/tasks/${t.id}`, 'PATCH', { done: on }).catch((err) => { setTicked((x) => { const y = { ...x }; delete y[t.id]; return y; }); throw err; })); }} />
                  <span><b>{t.title}</b><span className="muted">{[t.owner, t.dueDate && `${isDone(t) ? 'was due' : 'due'} ${fmtDate(t.dueDate)}`, !isDone(t) && t.dueDate && t.dueDate < today && 'overdue'].filter(Boolean).join(' · ')}</span></span></label>
                {t.note && notes[t.id] === undefined && <p className="tnote">{t.note}</p>}
                {canEdit && (notes[t.id] !== undefined ? (
                  <div className="row"><input value={notes[t.id]} maxLength={1000} aria-label={`Note for ${t.title}`} style={{ flex: 1 }} onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })} />
                    <button className="btn sm" onClick={() => act(() => api(`/api/offboarding/tasks/${t.id}`, 'PATCH', { note: notes[t.id] }), 'Note saved.').then(() => { const n = { ...notes }; delete n[t.id]; setNotes(n); })}>Save</button></div>
                ) : <button className="linkbtn" style={{ fontSize: 13 }} onClick={() => setNotes({ ...notes, [t.id]: t.note ?? '' })}>{t.note ? 'Edit note' : 'Add note'}</button>)}
              </li>
            ))}</ul>
            {canEdit && <form className="row" onSubmit={(e) => { e.preventDefault(); const title = adding[l.id]?.trim(); if (title) act(() => api(`/api/offboarding/${l.id}`, 'POST', { title }), 'Task added.').then(() => setAdding({ ...adding, [l.id]: '' })); }}>
              <input value={adding[l.id] ?? ''} maxLength={200} placeholder="Add a task (e.g. collect forklift key)" aria-label={`Add a task for ${l.name}`} style={{ flex: 1 }} onChange={(e) => setAdding({ ...adding, [l.id]: e.target.value })} />
              <button className="btn ghost sm">Add</button>
              <button type="button" className="btn ghost sm" onClick={() => open('candidates', l.candidateId)}>Documents</button></form>}
          </section>
        );
      })}
      {editing && <TemplateEditor items={template} onClose={() => setEditing(false)} onDone={() => { setEditing(false); router.refresh(); }} />}
    </>
  );
}

function TemplateEditor({ items, onClose, onDone }: { items: TemplateItem[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useRecords();
  const [v, setV] = useState(items.map((i) => ({ ...i, owner: i.owner ?? '' })));
  const [error, setError] = useState('');
  const save = async (list: typeof v) => {
    try { await api('/api/offboarding/template', 'PUT', { items: list }); toast(list.length ? 'Checklist saved.' : 'Back to the default checklist.'); onDone(); }
    catch (e) { setError((e as Error).message); }
  };
  return (
    <Drawer title="Offboarding checklist" onClose={onClose} footer={<><button className="btn" onClick={() => save(v)}>Save checklist</button><button className="btn ghost" onClick={onClose}>Cancel</button><span style={{ flex: 1 }} /><button className="btn ghost" onClick={() => save([])}>Use the default</button></>}>
      <p className="muted">Used for each departure from now on. “Days” is relative to the last day (−1 is the day before). The final-paycheck task is dated by the state’s rule.</p>
      {v.map((t, i) => (
        <div key={i} className="row" style={{ marginBottom: 6 }}>
          <input value={t.title} maxLength={200} aria-label={`Task ${i + 1}`} style={{ flex: 1, minWidth: 180 }} onChange={(e) => setV(v.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
          <input value={t.owner} maxLength={40} placeholder="Owner" aria-label={`Task ${i + 1} owner`} style={{ width: 100 }} onChange={(e) => setV(v.map((x, j) => (j === i ? { ...x, owner: e.target.value } : x)))} />
          {t.finalPay ? <span className="muted" style={{ width: 80 }}>state rule</span> : <input type="number" min={-30} max={90} value={t.days} aria-label={`Task ${i + 1} days`} style={{ width: 80 }} onChange={(e) => setV(v.map((x, j) => (j === i ? { ...x, days: Number(e.target.value) } : x)))} />}
          <button className="btn ghost sm" aria-label={`Remove task ${i + 1}`} onClick={() => setV(v.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="btn ghost sm" onClick={() => setV([...v, { title: '', owner: '', days: 0 }])}>+ Add task</button>
      {error && <p className="error" role="alert">{error}</p>}
    </Drawer>
  );
}
