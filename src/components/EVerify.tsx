'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords } from './Records';
import { STATUSES, type EvStatus } from '@/lib/everify';

export type EvRow = { id: string; name: string; startDate: string; dueDate: string; status: string; caseNumber: string | null; notes: string | null; urgency: 'overdue' | 'due' | 'ok' | 'done' };
const fmt = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** E-Verify cases: what to create by when, and where each case stands. */
export default function EVerifyBoard({ rows, enabled, isAdmin, canEdit, people, today }: { rows: EvRow[]; enabled: boolean; isAdmin: boolean; canEdit: boolean; people: { id: string; name: string }[]; today: string }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [edit, setEdit] = useState<{ id: string; status: string; caseNumber: string; notes: string } | null>(null);
  const [adding, setAdding] = useState<{ candidateId: string; startDate: string } | null>(null);
  const call = async (url: string, method: string, body: object, done: string) => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast(j.error ?? 'That didn’t work.', true); return false; }
    toast(done); router.refresh(); return true;
  };
  return (
    <>
      <div className="card">
        <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={enabled} disabled={!isAdmin || !canEdit} onChange={(e) => call('/api/everify', 'PATCH', { enabled: e.target.checked }, e.target.checked ? 'E-Verify tracking is on: placing someone opens a case to create.' : 'E-Verify tracking is off.')} />
          {' '}We’re enrolled in E-Verify — open a case to track whenever someone is placed</label>
        <p className="muted" style={{ marginBottom: 0 }}>Create each case in E-Verify no later than the third business day after the person starts work for pay, then record the case number and result here. (Sending cases to E-Verify directly requires enrolling as a Web Services employer agent.)</p>
      </div>
      {canEdit && (adding ? (
        <div className="card subform">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label>Person<select value={adding.candidateId} onChange={(e) => setAdding({ ...adding, candidateId: e.target.value })}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>First day of work<input type="date" value={adding.startDate} onChange={(e) => setAdding({ ...adding, startDate: e.target.value })} /></label>
          </div>
          <div className="row"><button className="btn sm" onClick={async () => { if (await call('/api/everify', 'POST', adding, 'Case added.')) setAdding(null); }}>Add</button><button className="btn ghost sm" onClick={() => setAdding(null)}>Cancel</button></div>
        </div>
      ) : people.length > 0 && <p><button className="btn ghost" onClick={() => setAdding({ candidateId: people[0].id, startDate: today })}>+ Track a case</button></p>)}
      {rows.length ? (
        <div className="tablewrap"><table><thead><tr><th>Person</th><th>Started</th><th>Create case by</th><th>Case number</th><th>Status</th>{canEdit && <th />}</tr></thead><tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><b>{r.name}</b>{r.notes && <div className="muted">{r.notes}</div>}</td>
              <td>{fmt(r.startDate)}</td>
              <td className={r.urgency === 'overdue' ? 'warnnum' : undefined}>{fmt(r.dueDate)}{r.urgency === 'overdue' && <div className="warn">Overdue</div>}{r.urgency === 'due' && <div className="warn">Due now</div>}</td>
              <td>{r.caseNumber ?? '—'}</td>
              <td><span className={`pill ${r.status === 'authorized' ? 'g' : r.status === 'tnc' || r.status === 'final_nonconfirmation' || r.urgency === 'overdue' ? 'r' : r.urgency === 'done' ? '' : 'a'}`}>{STATUSES[r.status as EvStatus]?.label ?? r.status}</span></td>
              {canEdit && <td>{edit?.id === r.id ? (
                <div className="subform">
                  <label>Case number<input value={edit.caseNumber} maxLength={30} onChange={(e) => setEdit({ ...edit, caseNumber: e.target.value })} /></label>
                  <label>Status<select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
                  <label>Notes<input value={edit.notes} maxLength={1000} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></label>
                  <div className="row"><button className="btn sm" onClick={async () => { if (await call(`/api/everify/${r.id}`, 'PATCH', { status: edit.status, caseNumber: edit.caseNumber, notes: edit.notes }, 'Saved.')) setEdit(null); }}>Save</button><button className="btn ghost sm" onClick={() => setEdit(null)}>Cancel</button></div>
                </div>
              ) : <button className="btn ghost sm" onClick={() => setEdit({ id: r.id, status: r.status, caseNumber: r.caseNumber ?? '', notes: r.notes ?? '' })}>Update</button>}</td>}
            </tr>
          ))}
        </tbody></table></div>
      ) : <div className="card empty"><b>No E-Verify cases</b>{enabled ? 'Cases appear here when you place someone.' : 'Turn on tracking above if your company uses E-Verify.'}</div>}
    </>
  );
}
