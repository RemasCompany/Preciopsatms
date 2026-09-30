'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRecords } from './Records';

type Row = { id: string; client: string | null; reason: string; source: string; createdAt: string; liftedAt: string | null; liftReason: string | null };

/** Candidate drawer: clients (or all) that this worker must not be sent back to. */
export default function DoNotReturn({ candidateId, canEdit }: { candidateId: string; canEdit: boolean }) {
  const { toast } = useRecords();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [clients, setClients] = useState<{ id: string; label: string }[]>([]);
  const [form, setForm] = useState<{ clientId: string; reason: string } | null>(null);
  const load = useCallback(async () => { const r = await fetch(`/api/dnr?candidate=${candidateId}`); if (r.ok) setRows(await r.json()); }, [candidateId]);
  useEffect(() => { load(); }, [load]);
  const send = async (url: string, method: string, body: object, ok: string) => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast(j.error ?? 'That didn’t work.', true); return false; }
    toast(ok); load(); return true;
  };
  const active = rows?.filter((r) => !r.liftedAt) ?? [];
  const lifted = rows?.filter((r) => r.liftedAt) ?? [];
  return (
    <section className="sec"><h3>Do not return {canEdit && !form && <button className="btn ghost sm" onClick={async () => { const r = await fetch('/api/records/clients'); setClients(r.ok ? await r.json() : []); setForm({ clientId: '', reason: '' }); }}>+ Add</button>}</h3>
      {form && (
        <div className="subform">
          <label>Don’t send them back to<select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">Any client (company-wide)</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
          <label>Why<input value={form.reason} maxLength={500} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. no-call no-show twice in March" /></label>
          <p className="muted">Stick to facts about work — attendance, safety, conduct. Blocks adding them to that client’s jobs, placing them there and scheduling them.</p>
          <div className="row"><button className="btn sm" onClick={async () => { if (await send('/api/dnr', 'POST', { candidateId, clientId: form.clientId || null, reason: form.reason }, 'Added to the do-not-return list.')) setForm(null); }}>Add</button><button className="btn ghost sm" onClick={() => setForm(null)}>Cancel</button></div>
        </div>
      )}
      {active.length ? <div className="list">{active.map((r) => (
        <div key={r.id} className="li"><span className="x"><b>{r.client ?? 'All clients'}</b><span className="muted">{r.reason} · {new Date(r.createdAt).toLocaleDateString()}{r.source !== 'staff' ? ` · from ${r.source}` : ''}</span></span>
          {canEdit && <button className="btn ghost sm" onClick={() => { const why = prompt('Why is this being lifted? (owners and admins only)'); if (why) send(`/api/dnr/${r.id}`, 'DELETE', { reason: why }, 'Lifted.'); }}>Lift</button>}</div>
      ))}</div> : rows && !form ? <p className="muted">Not on any do-not-return list.</p> : null}
      {lifted.length > 0 && <details><summary className="muted">{lifted.length} lifted</summary>{lifted.map((r) => <p key={r.id} className="muted" style={{ fontSize: 13 }}>{r.client ?? 'All clients'}: {r.reason} — lifted {new Date(r.liftedAt!).toLocaleDateString()} ({r.liftReason})</p>)}</details>}
    </section>
  );
}
