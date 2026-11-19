'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtDate, money } from '@/lib/people-shared';
import type { EmployeeRow } from '@/lib/people';
import type { JobChangeView } from '@/lib/job-changes';

type Opt = { id: string; name: string };
type Person = { id: string; name: string; title: string };
export type ChangeRow = JobChangeView & { canCancel?: boolean; employee?: string };
type Lookups = { everyone: Person[]; departments: Opt[]; branches: Opt[] };

const KIND_HELP: Record<string, string> = {
  PROMOTION: 'A move up: a new, more senior title, usually with more pay.',
  DEMOTION: 'A move down: a less senior title or lower pay.',
  LATERAL: 'Same level, different role, team, manager or location.',
  PAY: 'New pay in the same job: a raise, market adjustment or correction.',
};
const PILL: Record<string, string> = { PENDING: 'a', APPROVED: 'g', DECLINED: 'r', CANCELLED: '' };
const STATUS: Record<string, string> = { PENDING: 'Waiting for approval', APPROVED: 'Approved', DECLINED: 'Declined', CANCELLED: 'Cancelled' };
const today = () => new Date().toLocaleDateString('en-CA');

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  const j = await r?.json().catch(() => ({})) ?? {};
  if (!r?.ok) throw new Error(j.error ?? 'That didn’t go through. Try again.');
  return j as { message?: string };
}

/** What a change does, in one line: "Clerk → Lead Clerk · $20.00/hr → $24.00/hr · Department: Ops". */
export function describe(c: ChangeRow, l: Lookups) {
  const name = (list: Opt[] | Person[], id: string | null) => (id ? list.find((x) => x.id === id)?.name ?? 'someone no longer listed' : null);
  return [
    c.toTitle && `${c.fromTitle} → ${c.toTitle}`,
    c.payChange && (c.fromPay && c.toPay ? `${c.fromPay} → ${c.toPay}` : 'new pay'),
    c.toDepartmentId && `Department: ${name(l.departments, c.toDepartmentId)}`,
    c.toManagerId && `Manager: ${name(l.everyone, c.toManagerId)}`,
    c.toBranchId && `Location: ${name(l.branches, c.toBranchId)}`,
  ].filter(Boolean).join(' · ');
}

/** Propose a promotion, demotion, lateral move or pay change for one employee. */
export function JobChangeForm({ e, admin, lookups, approvalNeeded, onCancel, onDone }: { e: EmployeeRow; admin: boolean; lookups: Lookups; approvalNeeded: boolean; onCancel: () => void; onDone: (msg: string) => void }) {
  const [v, setV] = useState({ kind: 'PROMOTION', effectiveDate: today(), toTitle: '', toDepartmentId: '', toManagerId: '', toBranchId: '', toPayType: e.payType ?? 'HOURLY', toPayRate: '', reason: '', notifyEmployee: true });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k: string, x: string | boolean) => setV({ ...v, [k]: x });
  const pct = admin && e.payRate && v.toPayRate && v.toPayType === e.payType ? ((Number(v.toPayRate) - e.payRate) / e.payRate) * 100 : null;
  async function submit() {
    setBusy(true); setErr('');
    try {
      const r = await post(`/api/employees/${e.id}/job-changes`, { ...v, toPayRate: v.toPayRate === '' ? null : Number(v.toPayRate), toPayType: v.toPayRate === '' ? null : v.toPayType });
      onDone(r.message ?? 'Saved.');
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <section className="sec" aria-label="Change job">
      <h3>Promote or change job</h3>
      <div className="row" role="radiogroup" aria-label="Type of change" style={{ flexWrap: 'wrap', gap: 6 }}>
        {(['PROMOTION', 'DEMOTION', 'LATERAL', 'PAY'] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={v.kind === k} className={`btn sm ${v.kind === k ? '' : 'ghost'}`} onClick={() => set('kind', k)}>{{ PROMOTION: 'Promotion', DEMOTION: 'Demotion', LATERAL: 'Lateral move', PAY: 'Pay change' }[k]}</button>
        ))}
      </div>
      <p className="muted" style={{ margin: '6px 0' }}>{KIND_HELP[v.kind]}</p>
      {v.kind === 'DEMOTION' && <p className="card banner" role="note" style={{ fontSize: 14 }}>Base a demotion on documented performance or a business need, and tell them in writing before it starts. If they recently took leave, made a complaint, asked for an accommodation or shared a protected trait, check with HR or an employment lawyer first.</p>}
      <div className="form">
        <label><span>Effective date</span><input type="date" value={v.effectiveDate} onChange={(x) => set('effectiveDate', x.target.value)} /></label>
        {v.kind !== 'PAY' && <label><span>New title</span><input value={v.toTitle} maxLength={120} placeholder={`Now: ${e.title}`} onChange={(x) => set('toTitle', x.target.value)} /></label>}
        {(v.kind === 'LATERAL' || v.kind === 'PROMOTION' || v.kind === 'DEMOTION') && <>
          <label><span>New department</span><select value={v.toDepartmentId} onChange={(x) => set('toDepartmentId', x.target.value)}><option value="">No change{e.department ? ` (${e.department})` : ''}</option>{lookups.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label><span>New manager</span><select value={v.toManagerId} onChange={(x) => set('toManagerId', x.target.value)}><option value="">No change{e.manager ? ` (${e.manager})` : ''}</option>{lookups.everyone.filter((p) => p.id !== e.id).map((p) => <option key={p.id} value={p.id}>{p.name} — {p.title}</option>)}</select></label>
          {lookups.branches.length > 0 && <label><span>New location</span><select value={v.toBranchId} onChange={(x) => set('toBranchId', x.target.value)}><option value="">No change{e.location ? ` (${e.location})` : ''}</option>{lookups.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
        </>}
        <label><span>Paid</span><select value={v.toPayType} onChange={(x) => set('toPayType', x.target.value)}><option value="HOURLY">Hourly</option><option value="SALARY">Salary</option></select></label>
        <label><span>{v.toPayType === 'SALARY' ? 'New annual salary ($)' : 'New hourly rate ($)'}</span><input type="number" min={0} step="0.01" value={v.toPayRate} placeholder={admin && e.payRate !== null && e.payType ? `Now: ${money(e.payRate, e.payType)}` : v.kind === 'PAY' ? 'Required' : 'Leave blank to keep pay'} onChange={(x) => set('toPayRate', x.target.value)} /></label>
        <label className="full"><span>Reason</span><textarea rows={3} maxLength={1000} value={v.reason} placeholder={v.kind === 'DEMOTION' ? 'The documented reason, for example the performance plan and its outcome' : 'For example: led the night team for six months; strong annual review'} onChange={(x) => set('reason', x.target.value)} /></label>
      </div>
      {pct !== null && <p className="muted">{pct >= 0 ? '+' : ''}{pct.toFixed(1)}% from {money(e.payRate!, e.payType!)}.</p>}
      <label className="check"><input type="checkbox" checked={v.notifyEmployee} onChange={(x) => set('notifyEmployee', x.target.checked)} /> <span>Send {e.name.split(' ')[0]} a written notice when it’s approved <span className="muted">(new title, pay and date; recommended, and required in some states for pay changes)</span></span></label>
      {!admin && approvalNeeded && <p className="muted">HR approves it before it takes effect. You’ll get an email when it’s decided.</p>}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="row"><button className="btn" disabled={busy || v.reason.trim().length < 3} onClick={submit}>{busy ? 'Saving…' : admin || !approvalNeeded ? 'Save change' : 'Send for approval'}</button><button className="btn ghost" onClick={onCancel}>Cancel</button></div>
    </section>
  );
}

/** One employee's job changes, with approve, decline and cancel where allowed. */
export function JobChangeHistory({ rows, admin, lookups, onChanged }: { rows: ChangeRow[]; admin: boolean; lookups: Lookups; onChanged: (msg: string) => void }) {
  if (!rows.length) return null;
  return (
    <section className="sec"><h3>Job changes</h3>
      <ul className="plainlist">{rows.map((c) => <ChangeItem key={c.id} c={c} admin={admin} lookups={lookups} onChanged={onChanged} />)}</ul>
    </section>
  );
}

function ChangeItem({ c, admin, lookups, onChanged, who }: { c: ChangeRow; admin: boolean; lookups: Lookups; onChanged: (msg: string) => void; who?: string }) {
  const [note, setNote] = useState(''); const [pay, setPay] = useState(c.toPayRate !== null ? String(c.toPayRate) : '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const act = async (action: 'approve' | 'decline' | 'cancel') => {
    setBusy(true); setErr('');
    try { onChanged((await post(`/api/job-changes/${c.id}`, { action, note: note || undefined, ...(action === 'approve' && c.payChange && pay !== '' && Number(pay) !== c.toPayRate ? { toPayRate: Number(pay), toPayType: c.toPayType ?? undefined } : {}) })).message ?? 'Done.'); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <li style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 280px' }}>
        <b>{who ? `${who}: ` : ''}{c.kindLabel}</b> <span className={`pill ${PILL[c.status]}`}>{c.status === 'APPROVED' && !c.applied ? 'Approved · upcoming' : STATUS[c.status]}</span>
        <div>{describe(c, lookups) || '—'}</div>
        <div className="muted" style={{ fontSize: 13 }}>Effective {fmtDate(c.effectiveDate)} · proposed by {c.requestedBy ?? 'someone'}{c.decidedBy ? ` · ${c.status === 'CANCELLED' ? 'cancelled' : c.status.toLowerCase()} by ${c.decidedBy}` : ''}{c.employeeNotified ? ' · employee notified' : ''}</div>
        <div style={{ fontSize: 14, marginTop: 4 }}>“{c.reason}”</div>
        {c.decisionNote && <div className="muted" style={{ fontSize: 13 }}>Note: {c.decisionNote}</div>}
      </div>
      {(c.status === 'PENDING' && admin) || c.canCancel ? (
        <div style={{ flex: '1 1 240px' }}>
          {c.status === 'PENDING' && admin && c.payChange && <label style={{ margin: '0 0 6px' }}><span>Final pay ($) {c.fromPay ? <span className="muted">now {c.fromPay}</span> : null}</span><input type="number" min={0} step="0.01" value={pay} onChange={(x) => setPay(x.target.value)} /></label>}
          {c.status === 'PENDING' && admin && <input aria-label="Note (optional)" placeholder="Note (optional)" value={note} maxLength={500} onChange={(x) => setNote(x.target.value)} style={{ width: '100%', marginBottom: 6 }} />}
          <div className="row">
            {c.status === 'PENDING' && admin && <><button className="btn sm" disabled={busy} onClick={() => act('approve')}>Approve</button><button className="btn ghost sm" disabled={busy} onClick={() => act('decline')}>Decline</button></>}
            {c.canCancel && <button className="btn ghost sm" disabled={busy} onClick={() => act('cancel')}>Cancel it</button>}
          </div>
          {err && <p className="error" role="alert">{err}</p>}
        </div>
      ) : null}
    </li>
  );
}

/** HR's queue on the Employees page: everything waiting for approval, and whether managers need it. */
export function JobChangeQueue({ rows, approval, lookups }: { rows: ChangeRow[]; approval: boolean; lookups: Lookups }) {
  const router = useRouter();
  const [msg, setMsg] = useState(''); const [on, setOn] = useState(approval); const [err, setErr] = useState('');
  async function toggle(x: boolean) {
    setErr(''); setOn(x);
    const r = await fetch('/api/job-changes/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approval: x }) }).catch(() => null);
    if (!r?.ok) { setOn(!x); setErr('Couldn’t save that. Try again.'); }
  }
  return (
    <section className="card" id="job-changes" aria-label="Job changes waiting for approval">
      <h2 style={{ marginTop: 0 }}>Promotions & job changes{rows.length ? ` · ${rows.length} waiting for approval` : ''}</h2>
      {msg && <p className="banner" role="status">{msg}</p>}
      {rows.length ? <ul className="plainlist">{rows.map((c) => <ChangeItem key={c.id} c={{ ...c, canCancel: true }} admin lookups={lookups} who={c.employee} onChanged={(m) => { setMsg(m); router.refresh(); }} />)}</ul>
        : <p className="muted">Nothing waiting. Managers propose promotions, demotions and moves from an employee’s record (“Promote or change job”).</p>}
      <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={on} onChange={(x) => toggle(x.target.checked)} /> <span>Managers’ job changes need approval from an owner or admin <span className="muted">(recommended; when off, a manager’s change applies on its date without approval)</span></span></label>
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}
