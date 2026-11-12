'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clock, dayLabel } from '@/lib/schedule';

export type ChangeRow = { id: string; kind: 'DROP' | 'CHANGE'; note: string | null; worker: string; job: string; unit: string | null; date: string; start: string; end: string };

/** Workers' requests to give up or change a shift, answered in one place. */
export default function ShiftChangeRequests({ rows, canEdit }: { rows: ChangeRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [reply, setReply] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  if (!rows.length && !msg) return null;
  async function decide(r: ChangeRow, approve: boolean) {
    setBusy(r.id); setErr(''); setMsg('');
    const res = await fetch(`/api/schedule/change-requests/${r.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approve, reply: reply[r.id] ?? '' }) }).catch(() => null);
    const j = await res?.json().catch(() => ({})) ?? {};
    setBusy(null);
    if (!res?.ok) { setErr(j.error ?? 'That didn’t go through. Try again.'); return; }
    const first = r.worker.split(' ')[0];
    setMsg(`${approve ? 'Approved' : 'Declined'}. ${j.told ? `${first} was told.` : `Couldn’t reach ${first} (${j.problem}); let them know yourself.`}${j.cancelled ? ' The shift is cancelled; post it as an open shift below if you need it covered.' : approve && r.kind === 'CHANGE' ? ' Now edit the shift on the board and publish the week so they get the new details.' : ''}`);
    router.refresh();
  }
  return (
    <section className="card" aria-label="Shift change requests">
      <h2 style={{ marginTop: 0 }}>Shift change requests{rows.length ? ` (${rows.length})` : ''}</h2>
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="banner" role="status">{msg}</p>}
      <ul className="plainlist">{rows.map((r) => (
        <li key={r.id} style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px' }}>
            <b>{r.worker}</b> wants to {r.kind === 'DROP' ? 'give up' : 'change'} <b>{dayLabel(r.date)} {clock(r.start)}–{clock(r.end)}</b>
            <div className="muted">{[r.job, r.unit].filter(Boolean).join(' · ')}</div>
            {r.note && <div>“{r.note}”</div>}
          </div>
          {canEdit && (
            <div className="row" style={{ flex: '1 1 260px' }}>
              <input aria-label={`Reply to ${r.worker} (optional)`} placeholder="Reply (optional)" value={reply[r.id] ?? ''} maxLength={500} onChange={(e) => setReply({ ...reply, [r.id]: e.target.value })} />
              <button className="btn sm" disabled={busy === r.id} onClick={() => decide(r, true)}>Approve</button>
              <button className="btn ghost sm" disabled={busy === r.id} onClick={() => decide(r, false)}>Decline</button>
            </div>
          )}
        </li>
      ))}</ul>
    </section>
  );
}
