'use client';
import { useState } from 'react';
import ReviewAnswers, { RATING, type Answers, type Question } from './ReviewAnswers';

export type WorkerMe = {
  reviews?: { id: string; cycle: string; dueDate: string; questions: Question[]; canSelf: boolean; self: Answers | null; selfSubmitted: boolean;
    shared: null | { answers: Answers | null; rating: number | null; summary: string | null; acknowledged: boolean; agrees?: boolean | null; comment: string | null } }[];
  goals?: { id: string; title: string; details: string | null; dueDate: string | null; progress: number; status: string }[];
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
  const [drafts, setDrafts] = useState<Record<string, Answers>>(() => Object.fromEntries((me.reviews ?? []).map((r) => [r.id, r.self ?? {}])));
  const [ack, setAck] = useState<Record<string, string>>({});

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

      {me.reviews?.map((r) => (
        <div key={r.id} className="card">
          <h2 style={{ marginTop: 0 }}>{r.cycle}</h2>
          {r.canSelf ? <>
            <p className="muted">Your self review — please finish it by {fmt(r.dueDate)}. Your manager sees it once you submit.</p>
            <ReviewAnswers name={`self-${r.id}`} questions={r.questions} answers={drafts[r.id] ?? {}} onChange={(a) => setDrafts({ ...drafts, [r.id]: a })} />
            <div className="row"><button className="btn" disabled={busy} onClick={() => send({ action: 'selfReview', reviewId: r.id, answers: drafts[r.id] ?? {}, submit: true })}>Submit self review</button>
              <button className="btn ghost" disabled={busy} onClick={() => send({ action: 'selfReview', reviewId: r.id, answers: drafts[r.id] ?? {}, submit: false })}>Save for later</button></div>
          </> : r.selfSubmitted && !r.shared ? <p className="muted">You submitted your self review. Your manager’s review will show here when it’s shared with you.</p> : null}
          {r.shared && <>
            <p><b>Overall: {r.shared.rating ? `${r.shared.rating} — ${RATING[r.shared.rating]}` : 'not rated'}</b></p>
            {r.shared.summary && <p>{r.shared.summary}</p>}
            <ReviewAnswers name={`mgr-${r.id}`} questions={r.questions} answers={r.shared.answers} />
            {r.shared.acknowledged ? <p className="okc">{r.shared.agrees === false ? 'You acknowledged this review and noted that you disagree' : 'You acknowledged and accepted this review'}{r.shared.comment ? `: “${r.shared.comment}”` : ''}.</p> : <>
              <p style={{ margin: '10px 0 4px' }}><b>Please acknowledge your review</b></p>
              <label className="full"><span>Your comments (optional if you accept; needed if you disagree)</span><textarea rows={2} maxLength={2000} value={ack[r.id] ?? ''} onChange={(e) => setAck({ ...ack, [r.id]: e.target.value })} /></label>
              <div className="row">
                <button className="btn" disabled={busy} onClick={() => send({ action: 'acknowledge', reviewId: r.id, comment: ack[r.id] ?? '', agree: true })}>Acknowledge and accept</button>
                <button className="btn ghost" disabled={busy || (ack[r.id] ?? '').trim().length < 5} title="Add a comment saying what you disagree with" onClick={() => send({ action: 'acknowledge', reviewId: r.id, comment: ack[r.id] ?? '', agree: false })}>Acknowledge — I disagree</button>
              </div>
              <p className="muted" style={{ fontSize: 13 }}>Either way you’re confirming you’ve read it. If you disagree, say why in the comment — your manager and HR will follow up.</p>
            </>}
          </>}
        </div>
      ))}

      {!!me.goals?.length && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Your goals</h2>
          <ul className="plainlist">{me.goals.map((g) => (
            <li key={g.id} style={{ flexWrap: 'wrap' }}><div style={{ flex: '1 1 200px' }}><b>{g.title}</b>{g.dueDate && <span className="muted"> · by {fmt(g.dueDate)}</span>}{g.details && <div className="muted">{g.details}</div>}
              <div className="progress" aria-hidden="true"><i style={{ width: `${g.progress}%` }} /></div></div>
              {g.status === 'OPEN' ? <label className="row" style={{ margin: 0, gap: 6 }}><span className="muted">Progress</span>
                <select value={g.progress} disabled={busy} aria-label={`Progress on ${g.title}`} onChange={(e) => send({ action: 'goal', goalId: g.id, progress: Number(e.target.value) })}>
                  {[0, 10, 25, 50, 75, 90, 100].concat([g.progress]).filter((v, i, x) => x.indexOf(v) === i).sort((x, y) => x - y).map((n) => <option key={n} value={n}>{n}%</option>)}
                </select></label> : <span className="pill g">Done</span>}</li>
          ))}</ul>
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
