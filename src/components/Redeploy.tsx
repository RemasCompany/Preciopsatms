'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRecords } from './Records';
import { matchTone } from '@/lib/match';
import type { Ending } from '@/lib/redeploy';

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const when = (n: number) => (n === 0 ? 'ends today' : n > 0 ? `ends in ${n} day${n === 1 ? '' : 's'}` : `ended ${-n} day${n === -1 ? '' : 's'} ago`);

/** The redeployment board: who's coming off assignment, and what to do about each one. */
export default function RedeployBoard() {
  const { toast, open, canEdit } = useRecords();
  const [rows, setRows] = useState<Ending[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [handling, setHandling] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const load = useCallback(async () => { const r = await fetch('/api/redeploy'); setRows(r.ok ? await r.json() : []); }, []);
  useEffect(() => { load(); }, [load]);
  async function act(body: object, key: string) {
    setBusy(key);
    try {
      const r = await fetch('/api/redeploy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      toast(r.ok ? j.message : j.error ?? 'That didn’t work.', !r.ok);
      if (r.ok) { setHandling(null); await load(); }
    } finally { setBusy(null); }
  }
  if (!rows) return <p className="muted">Loading…</p>;
  const soon = rows.filter((r) => r.daysLeft >= 0), ended = rows.filter((r) => r.daysLeft < 0);
  const list = (items: Ending[]) => items.map((e) => (
    <div key={e.applicationId} className="card redeploy">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <button className="linkish" onClick={() => open('candidates', e.candidateId)}><b>{e.name}</b></button>
          <div className="muted">{e.job}{e.client ? ` · ${e.client}` : ''} · {fmt(e.endDate)}{e.inferred ? ' (last scheduled shift)' : ''}</div>
          {e.skills.length > 0 && <div className="muted" style={{ fontSize: 13 }}>{e.skills.join(', ')}</div>}
        </div>
        <span className={`pill ${e.daysLeft <= 3 ? 'r' : 'a'}`}>{when(e.daysLeft)}</span>
      </div>
      {e.matches.length ? <div className="list" style={{ marginTop: 8 }}>{e.matches.map((m) => (
        <div key={m.jobId} className="li"><span className="x"><button className="linkish" onClick={() => open('jobs', m.jobId)}><b>{m.title}</b></button><span className="muted">{m.location ?? ''}</span></span>
          <span className={`pill ${matchTone(m.score)}`}>{m.score}% match</span>
          {canEdit && <span className="row" style={{ gap: 6 }}>
            <button className="btn sm" disabled={!!busy} onClick={() => act({ action: 'submit', applicationId: e.applicationId, jobId: m.jobId }, e.applicationId + m.jobId)}>Put forward</button>
            {e.phone && !e.smsOptOut && <button className="btn ghost sm" disabled={!!busy} onClick={() => act({ action: 'text', applicationId: e.applicationId, jobId: m.jobId }, e.applicationId + m.jobId + 't')}>Text them about it</button>}
          </span>}</div>
      ))}</div> : <p className="muted">No open job fits well right now. Check their profile or add a job order.</p>}
      {canEdit && (handling === e.applicationId ? (
        <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          <input style={{ flex: '1 1 220px' }} autoFocus value={note} maxLength={200} placeholder="e.g. Extended to Dec 15, or not available" aria-label="What happened" onChange={(x) => setNote(x.target.value)} />
          <button className="btn sm" disabled={!!busy || note.trim().length < 2} onClick={() => act({ action: 'handled', applicationId: e.applicationId, note }, e.applicationId + 'h')}>Mark handled</button>
          <button className="btn ghost sm" onClick={() => setHandling(null)}>Cancel</button>
        </div>
      ) : (
        <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
          <label className="muted" style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>End date<input type="date" defaultValue={e.inferred ? '' : e.endDate} aria-label={`Assignment end date for ${e.name}`} onChange={(x) => x.target.value && act({ action: 'endDate', applicationId: e.applicationId, date: x.target.value }, e.applicationId + 'd')} style={{ width: 'auto' }} /></label>
          <button className="btn ghost sm" onClick={() => { setHandling(e.applicationId); setNote(''); }}>Mark handled</button>
        </div>
      ))}
    </div>
  ));
  return (
    <>
      <div className="kpis"><div className="kpi"><b>{soon.length}</b><span>Ending in the next 2 weeks</span></div><div className="kpi"><b className={ended.length ? 'warn' : ''}>{ended.length}</b><span>Ended, not redeployed</span></div></div>
      {!rows.length && <div className="card empty"><b>No one is coming off assignment</b>Set an end date on a placement (on the candidate’s record) and they’ll show here two weeks ahead. Placements whose scheduled shifts stop also show up.</div>}
      {soon.length > 0 && <><h2>Ending soon</h2>{list(soon)}</>}
      {ended.length > 0 && <><h2>Ended without a next assignment</h2>{list(ended)}</>}
    </>
  );
}
