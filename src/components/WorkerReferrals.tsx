'use client';
import { useState } from 'react';

export type WorkerRef = { bonus: number | null; minHours: number; jobs: { id: string; label: string }[]; mine: { id: string; name: string; status: string }[] };

/** "Refer a friend" on the worker's private page. */
export default function WorkerReferrals({ token, data, onChange }: { token: string; data: WorkerRef; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', phone: '', email: '', jobId: '', note: '' });
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/public/referrals/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: f.name, phone: f.phone || undefined, email: f.email || undefined, jobId: f.jobId || undefined, note: f.note || undefined }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg({ text: j.error ?? 'That didn’t go through. Try again.', bad: true });
    setMsg({ text: j.message }); setOpen(false); setF({ name: '', phone: '', email: '', jobId: '', note: '' }); onChange();
  }
  return (
    <section className="card" style={{ marginTop: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Know someone who’d be great? 🤝</h2>
      <p className="muted" style={{ marginTop: 4 }}>{data.bonus ? `Refer a friend and get $${data.bonus} once they’ve worked ${data.minHours} hours.` : 'Refer a friend — we’ll reach out to them.'}</p>
      {msg && <p className={msg.bad ? 'error' : 'banner'} role="status">{msg.text}</p>}
      {!open ? <button className="btn" onClick={() => setOpen(true)}>Refer a friend</button> : (
        <div className="subform">
          <label>Their name<input value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="off" /></label>
          <label>Phone<input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="off" /></label>
          <label>Email (optional)<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="off" /></label>
          {data.jobs.length > 0 && <label>For which job? (optional)<select value={f.jobId} onChange={(e) => setF({ ...f, jobId: e.target.value })}><option value="">Any job</option>{data.jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}</select></label>}
          <label>Anything we should know? (optional)<input value={f.note} maxLength={500} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. has a forklift license" /></label>
          <p className="muted" style={{ fontSize: 13 }}>Please ask your friend first — we’ll contact them about work.</p>
          <div className="row"><button className="btn" disabled={busy || !f.name} onClick={send}>{busy ? 'Sending…' : 'Send referral'}</button><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button></div>
        </div>
      )}
      {data.mine.length > 0 && <div className="list" style={{ marginTop: 10 }}>{data.mine.map((m) => <div key={m.id} className="li"><span className="x"><b>{m.name}</b></span><span className={`pill ${m.status.startsWith('Bonus') ? 'g' : m.status === 'Not eligible' ? '' : 'a'}`}>{m.status}</span></div>)}</div>}
    </section>
  );
}
