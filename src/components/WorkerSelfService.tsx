'use client';
import { useState } from 'react';

export type WorkerMe = {
  job: { title: string; department: string | null; location: string | null; manager: string | null; startDate: string; status: string; employeeNumber: string | null; salaried: boolean };
  contact: { email: string | null; phone: string | null };
  timeOff: null | {
    policies: { id: string; name: string; paid: boolean; tracked: boolean; balance: number | null; pending: number | null; usableFrom: string | null }[];
    requests: { id: string; policy: string; start: string; end: string; hours: number; status: 'PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED'; note: string | null; reply: string | null }[];
  };
  stubs: { runId: string; number: string; payDate: string; periodStart: string; periodEnd: string; hours: number; gross: number; paid: boolean }[];
  weeks: { weekEnding: string; regular: number; overtime: number; leave: number; gross: number; paid: boolean }[];
  documents: { id: string; title: string; status: string; signedAt: string | null; sent: string; download: boolean }[];
};

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const range = (a: string, b: string) => (a === b ? fmt(a) : `${fmt(a)} – ${fmt(b)}`);
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const STATUS = { PENDING: ['Waiting for approval', 'a'], APPROVED: ['Approved', 'g'], DENIED: ['Not approved', 'r'], CANCELLED: ['Withdrawn', ''] } as const;

/** The employee part of a worker's private page: job, time off, pay, documents and contact details. */
export default function WorkerSelfService({ token, me, onChange }: { token: string; me: WorkerMe; onChange: () => void }) {
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const today = new Date().toLocaleDateString('en-CA');
  const tracked = me.timeOff?.policies.filter((p) => p.tracked) ?? [];
  const [f, setF] = useState({ policyId: me.timeOff?.policies[0]?.id ?? '', startDate: today, endDate: today, hoursPerDay: '8', note: '' });
  const [contact, setContact] = useState({ email: me.contact.email ?? '', phone: me.contact.phone ?? '' });

  async function send(body: object, after?: () => void) {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/public/me/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ text: j.error ?? 'That didn’t go through. Try again.', bad: true }); return; }
    setMsg({ text: j.message }); after?.(); onChange();
  }

  return (
    <section className="selfserve" aria-label="Your job, time off and pay">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Your job</h2>
        <p style={{ margin: '4px 0' }}><b>{me.job.title}</b>{me.job.department ? ` · ${me.job.department}` : ''}{me.job.location ? ` · ${me.job.location}` : ''}</p>
        <p className="muted" style={{ margin: 0 }}>{me.job.manager ? `Reports to ${me.job.manager} · ` : ''}Started {fmt(me.job.startDate)}{me.job.employeeNumber ? ` · Employee #${me.job.employeeNumber}` : ''}{me.job.status === 'ON_LEAVE' ? ' · On leave' : ''}</p>
      </div>
      {msg && <p className={msg.bad ? 'error' : 'okc'} role={msg.bad ? 'alert' : 'status'}>{msg.text}</p>}

      {me.timeOff && me.timeOff.policies.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Time off</h2>
          {tracked.length > 0 && <div className="kpis">{tracked.map((p) => (
            <div key={p.id} className="kpi"><b>{(p.balance ?? 0).toFixed(1)}</b><span>{p.name} hours{p.pending ? ` · ${p.pending.toFixed(1)} requested` : ''}{p.usableFrom && p.usableFrom > today ? ` · usable from ${fmt(p.usableFrom)}` : ''}</span></div>
          ))}</div>}
          {asking ? (
            <div className="form" style={{ marginTop: 10 }}>
              <label className="full"><span>Kind of time off</span><select value={f.policyId} onChange={(e) => setF({ ...f, policyId: e.target.value })}>{me.timeOff.policies.map((p) => <option key={p.id} value={p.id}>{p.name}{p.paid ? '' : ' (unpaid)'}</option>)}</select></label>
              <label><span>First day</span><input type="date" value={f.startDate} min={today} onChange={(e) => setF({ ...f, startDate: e.target.value, endDate: e.target.value > f.endDate ? e.target.value : f.endDate })} /></label>
              <label><span>Last day</span><input type="date" value={f.endDate} min={f.startDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></label>
              <label><span>Hours per day</span><input type="number" min={0.25} max={24} step={0.25} value={f.hoursPerDay} onChange={(e) => setF({ ...f, hoursPerDay: e.target.value })} /></label>
              <label className="full"><span>Note for your manager</span><input value={f.note} maxLength={500} placeholder="Optional" onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
              <div className="row full"><button className="btn" disabled={busy} onClick={() => send({ action: 'leave', ...f }, () => setAsking(false))}>Send request</button><button className="btn ghost" onClick={() => setAsking(false)}>Cancel</button></div>
            </div>
          ) : <button className="btn" style={{ marginTop: 10 }} onClick={() => setAsking(true)}>Request time off</button>}
          {me.timeOff.requests.length > 0 && <ul className="plainlist">{me.timeOff.requests.map((r) => (
            <li key={r.id}><div><b>{r.policy}</b> · {range(r.start, r.end)} · {+r.hours.toFixed(2)}h{r.reply && <div className="muted">Reply: {r.reply}</div>}</div>
              <span className="row"><span className={`pill ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
                {r.status === 'PENDING' && <button className="btn ghost sm" disabled={busy} onClick={() => send({ action: 'cancelLeave', requestId: r.id })}>Withdraw</button>}</span></li>
          ))}</ul>}
        </div>
      )}

      {(me.stubs.length > 0 || me.weeks.length > 0) && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Pay</h2>
          {me.stubs.length > 0 ? <ul className="plainlist">{me.stubs.map((s) => (
            <li key={s.runId}><div><b>{fmt(s.payDate)}</b> · {usd(s.gross)} gross<div className="muted">{range(s.periodStart, s.periodEnd)} · {s.hours} hours{s.paid ? '' : ' · scheduled'}</div></div>
              <a className="btn ghost sm" href={`/api/public/me/${token}/statement?run=${s.runId}`}>Pay summary (PDF)</a></li>
          ))}</ul> : <ul className="plainlist">{me.weeks.map((w) => (
            <li key={w.weekEnding}><div><b>Week ending {fmt(w.weekEnding)}</b> · {usd(w.gross)} gross<div className="muted">{w.regular}h regular{w.overtime ? ` · ${w.overtime}h overtime` : ''}{w.leave ? ` · ${w.leave}h time off` : ''}</div></div><span className={`pill ${w.paid ? 'g' : ''}`}>{w.paid ? 'Paid' : 'Approved'}</span></li>
          ))}</ul>}
          <p className="muted" style={{ fontSize: 13 }}>Amounts are before taxes and deductions. Your official pay stub comes from payroll.</p>
        </div>
      )}
      {me.job.salaried && !me.stubs.length && <p className="muted">You’re salaried, so your pay doesn’t depend on hours. Your pay stubs come from payroll.</p>}

      {me.documents.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Your documents</h2>
          <ul className="plainlist">{me.documents.map((d) => (
            <li key={d.id}><div><b>{d.title}</b><div className="muted">{d.signedAt ? `Signed ${fmt(d.signedAt)}` : `Sent ${fmt(d.sent)} — check your email to sign`}</div></div>
              {d.download && <a className="btn ghost sm" href={`/api/public/me/${token}/document?id=${d.id}`}>Download</a>}</li>
          ))}</ul>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Your contact details</h2>
        {editing ? (
          <div className="form">
            <label><span>Email</span><input type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></label>
            <label><span>Mobile phone</span><input type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></label>
            <div className="row full"><button className="btn" disabled={busy} onClick={() => send({ action: 'profile', ...contact }, () => setEditing(false))}>Save</button><button className="btn ghost" onClick={() => setEditing(false)}>Cancel</button></div>
          </div>
        ) : <><p style={{ margin: '4px 0' }}>{me.contact.email ?? <span className="muted">No email</span>} · {me.contact.phone ?? <span className="muted">No phone</span>}</p><button className="btn ghost sm" onClick={() => setEditing(true)}>Update</button></>}
      </div>
    </section>
  );
}
