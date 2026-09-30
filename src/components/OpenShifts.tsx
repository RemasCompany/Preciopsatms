'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Drawer from './Drawer';
import { useRecords } from './Records';
import { SHIFT_PRESETS, clockLong, dayLabel } from '@/lib/schedule';

export type OpenRow = { id: string; date: string; start: string; end: string; unit: string | null; job: string; slots: number; filled: number; status: string; offered: number; declined: number; takers: string[] };
type Job = { id: string; label: string; pool: number };
type Prefill = { jobId: string; date: string; start: string; end: string; breakMinutes: number; unit: string | null; label: string };
type PoolWorker = { candidateId: string; name: string; canText: boolean; canEmail: boolean; reason: string | null; offer: string | null };

const post = async (url: string, method: string, body?: object) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, j: await r.json().catch(() => ({})) };
};

/** Open shifts: post a shift nobody is on yet and offer it to the job's worker pool — first to accept gets it. */
export default function OpenShifts({ rows, jobs, declined, canEdit, today }: { rows: OpenRow[]; jobs: Job[]; declined: Prefill[]; canEdit: boolean; today: string }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [form, setForm] = useState<null | { jobId: string; date: string; start: string; end: string; breakMinutes: number; unit: string; slots: number }>(null);
  const [offering, setOffering] = useState<OpenRow | null>(null);
  const [workers, setWorkers] = useState<PoolWorker[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [channels, setChannels] = useState<('sms' | 'email')[]>(['sms']);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');

  const open = (p?: Prefill) => { setError(''); setForm(p ? { ...p, unit: p.unit ?? '', slots: 1 } : { jobId: jobs[0]?.id ?? '', date: today, start: SHIFT_PRESETS[0].start, end: SHIFT_PRESETS[0].end, breakMinutes: SHIFT_PRESETS[0].breakMinutes, unit: '', slots: 1 }); };
  async function create() {
    if (!form) return;
    setBusy(true); setError('');
    const { ok, j } = await post('/api/open-shifts', 'POST', { jobId: form.jobId, dates: [form.date], start: form.start, end: form.end, breakMinutes: form.breakMinutes, unit: form.unit || null, slots: form.slots });
    setBusy(false);
    if (!ok) return setError(j.error ?? 'Could not post the shift.');
    toast('Open shift posted. Offer it to the pool when you’re ready.'); setForm(null); router.refresh();
  }
  async function startOffer(r: OpenRow) {
    setOffering(r); setWorkers(null); setError('');
    const { ok, j } = await post(`/api/open-shifts/${r.id}/pool`, 'GET');
    if (!ok) return setError(j.error ?? 'Could not load the pool.');
    setWorkers(j.workers);
    setPicked(j.workers.filter((w: PoolWorker) => !w.reason && !w.offer).map((w: PoolWorker) => w.candidateId));
  }
  async function send() {
    if (!offering) return;
    setBusy(true); setError('');
    const { ok, j } = await post(`/api/open-shifts/${offering.id}/offer`, 'POST', { candidateIds: picked, channels });
    setBusy(false);
    if (!ok) return setError(j.error ?? 'Could not send the offer.');
    toast(`Offered to ${j.sent} worker${j.sent === 1 ? '' : 's'}.${j.problems.length ? ` Couldn’t reach: ${j.problems.join('; ')}` : ''}`, !j.sent);
    setOffering(null); router.refresh();
  }
  async function cancel(r: OpenRow) {
    if (!confirm('Cancel this open shift? Pending offers are withdrawn; anyone who already accepted keeps their shift.')) return;
    const { ok, j } = await post(`/api/open-shifts/${r.id}`, 'DELETE');
    if (!ok) return toast(j.error ?? 'Could not cancel.', true);
    toast('Open shift cancelled.'); router.refresh();
  }

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Open shifts</h2>
        {canEdit && jobs.length > 0 && <button className="btn sm" onClick={() => open()}>+ Open shift</button>}
      </div>
      <p className="muted" style={{ marginTop: 4 }}>Need extra hands or a replacement? Post the shift and text it to the job’s workers — the first to accept gets it, confirmed, on their schedule.</p>
      {canEdit && declined.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap' }}>{declined.map((d, i) => <button key={i} className="btn ghost sm" onClick={() => open(d)}>Fill {d.label}</button>)}</div>
      )}
      {rows.length ? (
        <div className="list">{rows.map((r) => (
          <div key={r.id} className="li" style={{ flexWrap: 'wrap' }}>
            <div className="x"><b>{dayLabel(r.date)} · {clockLong(r.start)}–{clockLong(r.end)}</b>
              <span className="muted">{r.job}{r.unit ? ` · ${r.unit}` : ''} · {r.filled} of {r.slots} filled{r.offered ? ` · offered to ${r.offered}` : ''}{r.declined ? `, ${r.declined} passed` : ''}{r.takers.length ? ` · ${r.takers.join(', ')}` : ''}</span></div>
            <span className={`pill ${r.status === 'FILLED' ? 'g' : r.status === 'CANCELLED' ? '' : 'a'}`}>{r.status === 'FILLED' ? 'Filled' : r.status === 'CANCELLED' ? 'Cancelled' : r.offered ? 'Offered' : 'Not offered'}</span>
            {canEdit && r.status === 'OPEN' && r.date >= today && <span className="row"><button className="btn ghost sm" onClick={() => startOffer(r)}>{r.offered ? 'Offer to more' : 'Offer to pool'}</button><button className="btn ghost sm" onClick={() => cancel(r)}>Cancel</button></span>}
          </div>
        ))}</div>
      ) : <p className="muted" style={{ margin: 0 }}>No open shifts this week.</p>}

      {form && (
        <Drawer title="Open shift" kicker="Offer to a job’s pool" onClose={() => setForm(null)}
          footer={<><button className="btn" disabled={busy || !form.jobId} onClick={create}>{busy ? 'Posting…' : 'Post shift'}</button><button className="btn ghost" onClick={() => setForm(null)}>Cancel</button></>}>
          <label><span>Job</span><select value={form.jobId} onChange={(e) => setForm({ ...form, jobId: e.target.value })}>{jobs.map((j) => <option key={j.id} value={j.id}>{j.label} — {j.pool} worker{j.pool === 1 ? '' : 's'} in the pool</option>)}</select></label>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label><span>Day</span><input type="date" min={today} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
            <label><span>Start</span><input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label>
            <label><span>End</span><input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></label>
            <label><span>Break (min)</span><input type="number" min={0} max={240} value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: Number(e.target.value) })} style={{ width: 90 }} /></label>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label><span>Unit or post (optional)</span><input value={form.unit} maxLength={80} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></label>
            <label><span>People needed</span><input type="number" min={1} max={50} value={form.slots} onChange={(e) => setForm({ ...form, slots: Number(e.target.value) })} style={{ width: 90 }} /></label>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </Drawer>
      )}

      {offering && (
        <Drawer title="Offer to the pool" kicker={`${dayLabel(offering.date)} · ${clockLong(offering.start)}–${clockLong(offering.end)} · ${offering.job}`} onClose={() => setOffering(null)}
          footer={<><button className="btn" disabled={busy || !picked.length || !channels.length} onClick={send}>{busy ? 'Sending…' : `Send to ${picked.length}`}</button><button className="btn ghost" onClick={() => setOffering(null)}>Cancel</button></>}>
          {!workers ? <p className="muted">Loading the pool…</p> : !workers.length ? <p className="warn">No one is on assignment to this job yet.</p> : workers.map((w) => (
            <label key={w.candidateId} className="check">
              <input type="checkbox" disabled={!!w.reason || !!w.offer} checked={picked.includes(w.candidateId)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, w.candidateId] : p.filter((x) => x !== w.candidateId)))} />
              {' '}{w.name} <span className="muted">{w.reason ?? (w.offer ? `already ${w.offer === 'OFFERED' ? 'offered' : w.offer.toLowerCase()}` : [w.canText && 'text', w.canEmail && 'email'].filter(Boolean).join(' or '))}</span>
            </label>
          ))}
          <div className="row" role="group" aria-label="Send by">{(['sms', 'email'] as const).map((c) => <label key={c} className="check" style={{ margin: 0 }}><input type="checkbox" checked={channels.includes(c)} onChange={(e) => setChannels((x) => (e.target.checked ? [...x, c] : x.filter((y) => y !== c)))} /> {c === 'sms' ? 'Text' : 'Email'}</label>)}</div>
          <p className="muted">Each worker gets one message with their private link. The first to accept gets the shift, confirmed; after that, everyone else sees it’s taken.</p>
          {error && <p className="error" role="alert">{error}</p>}
        </Drawer>
      )}
    </section>
  );
}
