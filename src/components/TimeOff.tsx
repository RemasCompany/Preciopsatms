'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Drawer from './Drawer';
import { useRecords } from './Records';
import { EMPLOYMENT_TYPES, TYPE_LABEL, fmtDate } from '@/lib/people-shared';

export type LeaveRow = { id: string; employeeId: string; employee: string; policy: string; paid: boolean; start: string; end: string; hours: number; note: string | null; status: 'PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED'; decisionNote: string | null; byEmployee: boolean };
export type PolicyRow = { id: string; name: string; paid: boolean; method: 'NONE' | 'ANNUAL' | 'HOURS_WORKED'; rate: number; maxBalance: number | null; waitingDays: number; types: string[]; archived: boolean };
export type BalanceRow = { employeeId: string; name: string; department: string | null; type: string; cells: { policyId: string; balance: number; pending: number }[] };
type CalRow = { id: string; employee: string; policy: string; start: string; end: string; status: string };

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Try again.');
  return json;
}
const range = (a: string, b: string) => (a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);
const PILL = { PENDING: 'a', APPROVED: 'g', DENIED: 'r', CANCELLED: '' } as const;
const STATUS = { PENDING: 'Waiting', APPROVED: 'Approved', DENIED: 'Denied', CANCELLED: 'Cancelled' } as const;
export const earning = (p: Pick<PolicyRow, 'method' | 'rate'>) =>
  p.method === 'NONE' ? 'Not tracked' : p.method === 'ANNUAL' ? `${+p.rate.toFixed(2)} hours a year, credited monthly` : `1 hour per ${+(1 / p.rate).toFixed(1)} worked`;

export default function TimeOff({ requests, month, calendar, policies, balances, employees, canEdit, admin, today }: {
  requests: LeaveRow[]; month: string; calendar: CalRow[]; policies: PolicyRow[]; balances: BalanceRow[]; employees: { id: string; name: string; type: string }[]; canEdit: boolean; admin: boolean; today: string;
}) {
  const router = useRouter();
  const { toast } = useRecords();
  const [tab, setTab] = useState<'requests' | 'calendar' | 'balances' | 'policies'>(requests.some((r) => r.status === 'PENDING') || policies.length ? 'requests' : 'policies');
  const [asking, setAsking] = useState(false);
  const [policy, setPolicy] = useState<PolicyRow | 'new' | null>(null);
  const [adjusting, setAdjusting] = useState<{ employeeId: string; policyId: string } | null>(null);
  const [busy, setBusy] = useState('');
  const live = policies.filter((p) => !p.archived);

  async function decide(r: LeaveRow, action: 'approve' | 'deny' | 'cancel') {
    let note: string | null = null;
    if (action === 'deny') { note = prompt(`Why can’t ${r.employee} have this time off? They’ll see your note.`); if (note === null) return; }
    if (action === 'cancel' && !confirm(`Cancel ${r.employee}’s ${r.policy.toLowerCase()} (${range(r.start, r.end)})?${r.status === 'APPROVED' ? ' The hours go back to their balance.' : ''}`)) return;
    setBusy(r.id);
    try {
      const res = await api(`/api/time-off/requests/${r.id}`, 'POST', { action, note });
      const locked = res.lockedWeeks?.length ? ` The timesheet for the week ending ${res.lockedWeeks.map(fmtDate).join(', ')} is already approved — reopen it to update the time-off hours.` : '';
      toast(action === 'approve' ? `Approved.${res.removedShifts ? ` ${res.removedShifts} shift${res.removedShifts === 1 ? '' : 's'} came off the schedule.` : ''}${locked}` : action === 'deny' ? 'Denied.' : `Cancelled.${locked}`, !!locked);
      router.refresh();
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(''); }
  }

  const pending = requests.filter((r) => r.status === 'PENDING');
  const upcoming = requests.filter((r) => r.status === 'APPROVED' && r.end >= today);
  const closed = requests.filter((r) => !pending.includes(r) && !upcoming.includes(r));
  const List = ({ rows, empty }: { rows: LeaveRow[]; empty: string }) => rows.length ? (
    <div className="list">{rows.map((r) => (
      <div key={r.id} className="li">
        <div className="x"><b>{r.employee}</b>
          <span className="muted">{r.policy}{r.paid ? '' : ' (unpaid)'} · {range(r.start, r.end)} · {+r.hours.toFixed(2)}h{r.byEmployee ? ' · asked by the employee' : ''}</span>
          {r.note && <span className="muted">“{r.note}”</span>}{r.decisionNote && <span className="muted">Reply: {r.decisionNote}</span>}
        </div>
        <span className="row">
          <span className={`pill ${PILL[r.status]}`}>{STATUS[r.status]}</span>
          {canEdit && r.status === 'PENDING' && <><button className="btn sm" disabled={busy === r.id} onClick={() => decide(r, 'approve')}>Approve</button><button className="btn ghost sm" disabled={busy === r.id} onClick={() => decide(r, 'deny')}>Deny</button></>}
          {canEdit && (r.status === 'PENDING' || (r.status === 'APPROVED' && r.end >= today)) && <button className="btn ghost sm" disabled={busy === r.id} onClick={() => decide(r, 'cancel')} aria-label={`Cancel ${r.employee}’s request`}>Cancel</button>}
        </span>
      </div>
    ))}</div>
  ) : <p className="muted">{empty}</p>;

  return (
    <>
      <div className="bar">
        <div className="tabs" role="tablist">
          {(['requests', 'calendar', 'balances', 'policies'] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={`btn ghost sm${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>{{ requests: `Requests${pending.length ? ` (${pending.length})` : ''}`, calendar: 'Who’s out', balances: 'Balances', policies: 'Policies' }[t]}</button>)}
        </div>
        <span className="grow" />
        {canEdit && live.length > 0 && <button className="btn" onClick={() => setAsking(true)}>+ Request time off</button>}
        {admin && tab === 'policies' && <button className="btn ghost" onClick={() => setPolicy('new')}>+ Add policy</button>}
      </div>

      {tab === 'requests' && (!live.length ? (
        <div className="card empty"><b>Set up a time-off policy first</b>{admin ? <>Add vacation, sick or unpaid leave under <button className="linkbtn" onClick={() => setTab('policies')}>Policies</button>, then requests and balances start here.</> : 'An owner or admin sets up the kinds of time off your company offers.'}</div>
      ) : <>
        <h2>Waiting for approval</h2><div className="card"><List rows={pending} empty="Nothing to approve." /></div>
        <h2>Approved, coming up</h2><div className="card"><List rows={upcoming} empty="No one has time off coming up." /></div>
        {closed.length > 0 && <><h2>Recent</h2><div className="card"><List rows={closed} empty="" /></div></>}
      </>)}

      {tab === 'calendar' && <Calendar month={month} rows={calendar} today={today} />}

      {tab === 'balances' && (
        live.some((p) => p.method !== 'NONE') ? (
          <div className="tablewrap"><table>
            <thead><tr><th>Employee</th>{live.filter((p) => p.method !== 'NONE').map((p) => <th key={p.id}>{p.name}<div className="muted" style={{ fontWeight: 400 }}>hours</div></th>)}</tr></thead>
            <tbody>{balances.map((b) => (
              <tr key={b.employeeId}><td><b>{b.name}</b><div className="muted">{[b.department, TYPE_LABEL[b.type]].filter(Boolean).join(' · ')}</div></td>
                {live.filter((p) => p.method !== 'NONE').map((p) => {
                  const c = b.cells.find((x) => x.policyId === p.id);
                  return <td key={p.id}>{c ? <><b className={c.balance < 0 ? 'warnnum' : undefined}>{c.balance.toFixed(2)}</b>{c.pending > 0 && <div className="muted">{c.pending.toFixed(2)} requested</div>}
                    {admin && <div><button className="linkbtn" style={{ fontSize: 13 }} onClick={() => setAdjusting({ employeeId: b.employeeId, policyId: p.id })}>Adjust</button></div>}</> : <span className="muted">Not eligible</span>}</td>;
                })}</tr>
            ))}</tbody>
          </table></div>
        ) : <div className="card empty"><b>No balances to show</b>Balances appear for policies that earn hours (vacation, sick). Untracked kinds like unpaid leave have none.</div>
      )}

      {tab === 'policies' && (
        policies.length ? <div className="list card">{policies.map((p) => (
          <div key={p.id} className="li">
            <div className="x"><b>{p.name}{p.archived ? ' (archived)' : ''}</b>
              <span className="muted">{p.paid ? 'Paid' : 'Unpaid'} · {earning(p)}{p.maxBalance != null ? ` · up to ${p.maxBalance} hours` : ''}{p.waitingDays ? ` · usable after ${p.waitingDays} days` : ''} · {p.types.length ? p.types.map((t) => TYPE_LABEL[t]).join(', ') : 'everyone'}</span></div>
            {admin && <span className="row"><button className="btn ghost sm" onClick={() => setPolicy(p)}>Edit</button>
              <button className="btn ghost sm" onClick={async () => { try { await api(`/api/time-off/policies/${p.id}`, 'PATCH', { archived: !p.archived }); toast(p.archived ? 'Restored.' : 'Archived. Balances and history are kept.'); router.refresh(); } catch (e) { toast((e as Error).message, true); } }}>{p.archived ? 'Restore' : 'Archive'}</button></span>}
          </div>
        ))}</div> : <div className="card empty"><b>No policies yet</b>{admin ? 'Add the kinds of time off you offer. Common setups: Vacation, 80 hours a year; Sick, 1 hour per 30 worked (many states require this); Unpaid leave, not tracked.' : 'An owner or admin sets these up.'}</div>
      )}

      {asking && <AskDrawer employees={employees} policies={live} balances={balances} onClose={() => setAsking(false)} onDone={() => { setAsking(false); router.refresh(); setTab('requests'); }} />}
      {policy && <PolicyDrawer policy={policy === 'new' ? null : policy} onClose={() => setPolicy(null)} onDone={() => { setPolicy(null); router.refresh(); }} />}
      {adjusting && <AdjustDrawer {...adjusting} name={balances.find((b) => b.employeeId === adjusting.employeeId)?.name ?? ''} policy={policies.find((p) => p.id === adjusting.policyId)?.name ?? ''} onClose={() => setAdjusting(null)} onDone={() => { setAdjusting(null); router.refresh(); }} />}
    </>
  );
}

function Calendar({ month, rows, today }: { month: string; rows: CalRow[]; today: string }) {
  const first = new Date(`${month}-01T00:00:00Z`);
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // weeks start Monday
  const shift = (n: number) => { const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + n, 1)); return d.toISOString().slice(0, 7); };
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  return (
    <>
      <div className="bar weeknav"><a className="btn ghost" href={`?month=${shift(-1)}`} aria-label="Previous month">←</a><b>{first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</b><a className="btn ghost" href={`?month=${shift(1)}`} aria-label="Next month">→</a></div>
      <div className="leavecal" role="grid" aria-label="Who’s out">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="h" role="columnheader">{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`x${i}`} className="d empty" />;
          const out = rows.filter((r) => r.start <= d && r.end >= d);
          return (
            <div key={d} className={`d${d === today ? ' today' : ''}`} role="gridcell" aria-label={`${fmtDate(d)}: ${out.length ? out.map((r) => r.employee).join(', ') : 'no one out'}`}>
              <span className="n">{Number(d.slice(8))}</span>
              {out.slice(0, 4).map((r) => <span key={r.id} className={`who${r.status === 'PENDING' ? ' pending' : ''}`} title={`${r.employee}: ${r.policy}${r.status === 'PENDING' ? ' (waiting)' : ''}`}>{r.employee.split(' ')[0]}</span>)}
              {out.length > 4 && <span className="muted">+{out.length - 4}</span>}
            </div>
          );
        })}
      </div>
      <p className="legend"><span><i className="leavedot" />Approved</span><span><i className="leavedot pending" />Waiting for approval</span></p>
    </>
  );
}

function AskDrawer({ employees, policies, balances, onClose, onDone }: { employees: { id: string; name: string; type: string }[]; policies: PolicyRow[]; balances: BalanceRow[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useRecords();
  const todayLocal = new Date().toLocaleDateString('en-CA');
  const [v, setV] = useState({ employeeId: employees[0]?.id ?? '', policyId: '', startDate: todayLocal, endDate: todayLocal, hoursPerDay: '8', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const emp = employees.find((e) => e.id === v.employeeId);
  const offered = policies.filter((p) => !p.types.length || (emp && p.types.includes(emp.type)));
  const policyId = offered.some((p) => p.id === v.policyId) ? v.policyId : offered[0]?.id ?? '';
  const cell = balances.find((b) => b.employeeId === v.employeeId)?.cells.find((c) => c.policyId === policyId);
  async function save() {
    setBusy(true); setError('');
    try { const r = await api('/api/time-off/requests', 'POST', { ...v, policyId }); toast(`Requested ${r.hours} hours over ${r.days} day${r.days === 1 ? '' : 's'}.`); onDone(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Request time off" onClose={onClose} footer={<><button className="btn" onClick={save} disabled={busy || !policyId}>Send request</button><button className="btn ghost" onClick={onClose}>Cancel</button></>}>
      <div className="form">
        <label className="full"><span>Employee</span><select value={v.employeeId} onChange={(e) => setV({ ...v, employeeId: e.target.value })}>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <label className="full"><span>Kind of time off</span><select value={policyId} onChange={(e) => setV({ ...v, policyId: e.target.value })}>{offered.map((p) => <option key={p.id} value={p.id}>{p.name}{p.paid ? '' : ' (unpaid)'}</option>)}</select></label>
        <label><span>First day</span><input type="date" value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value, endDate: e.target.value > v.endDate ? e.target.value : v.endDate })} /></label>
        <label><span>Last day</span><input type="date" value={v.endDate} min={v.startDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} /></label>
        <label><span>Hours per day</span><input type="number" min={0.25} max={24} step={0.25} value={v.hoursPerDay} onChange={(e) => setV({ ...v, hoursPerDay: e.target.value })} /></label>
        <label className="full"><span>Note</span><input value={v.note} maxLength={500} placeholder="Optional" onChange={(e) => setV({ ...v, note: e.target.value })} /></label>
      </div>
      {!offered.length && <p className="warn">No time-off policy covers this employee’s employment type.</p>}
      {cell && <p className="muted">Balance: {cell.balance.toFixed(2)} hours{cell.pending ? `, ${cell.pending.toFixed(2)} already requested` : ''}.</p>}
      <p className="muted">Counts the days they’re scheduled in that range, or weekdays if nothing is scheduled yet.</p>
      {error && <p className="error" role="alert">{error}</p>}
    </Drawer>
  );
}

function PolicyDrawer({ policy, onClose, onDone }: { policy: PolicyRow | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useRecords();
  const [v, setV] = useState({ name: policy?.name ?? '', paid: policy?.paid ?? true, method: policy?.method ?? 'ANNUAL', annual: policy?.method === 'ANNUAL' ? String(policy.rate) : '80',
    per: policy?.method === 'HOURS_WORKED' ? String(+(1 / policy.rate).toFixed(2)) : '30', maxBalance: policy?.maxBalance != null ? String(policy.maxBalance) : '', waitingDays: String(policy?.waitingDays ?? 0), types: policy?.types ?? [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    const rate = v.method === 'ANNUAL' ? Number(v.annual) : v.method === 'HOURS_WORKED' ? (Number(v.per) > 0 ? 1 / Number(v.per) : 0) : 0;
    try {
      await api(policy ? `/api/time-off/policies/${policy.id}` : '/api/time-off/policies', policy ? 'PATCH' : 'POST', { name: v.name, paid: v.paid, method: v.method, rate, maxBalance: v.maxBalance === '' ? null : Number(v.maxBalance), waitingDays: Number(v.waitingDays) || 0, types: v.types });
      toast('Saved.'); onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Drawer title={policy ? `Edit ${policy.name}` : 'Add time-off policy'} onClose={onClose} footer={<><button className="btn" onClick={save} disabled={busy}>Save policy</button><button className="btn ghost" onClick={onClose}>Cancel</button></>}>
      <div className="form">
        <label className="full"><span>Name</span><input value={v.name} maxLength={60} placeholder="e.g. Vacation, Sick, Bereavement" onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
        <label className="check full"><input type="checkbox" checked={v.paid} onChange={(e) => setV({ ...v, paid: e.target.checked })} /> Paid (approved hours are paid at the employee’s regular rate)</label>
        <label className="full"><span>How it’s earned</span><select value={v.method} onChange={(e) => setV({ ...v, method: e.target.value as PolicyRow['method'] })}>
          <option value="ANNUAL">Hours per year, credited monthly</option><option value="HOURS_WORKED">Per hours worked (e.g. paid sick leave)</option><option value="NONE">Not tracked (no balance)</option></select></label>
        {v.method === 'ANNUAL' && <label><span>Hours per year</span><input type="number" min={0} step={1} value={v.annual} onChange={(e) => setV({ ...v, annual: e.target.value })} /></label>}
        {v.method === 'HOURS_WORKED' && <label><span>1 hour for every … hours worked</span><input type="number" min={1} step={1} value={v.per} onChange={(e) => setV({ ...v, per: e.target.value })} /></label>}
        {v.method !== 'NONE' && <label><span>Balance cap (hours)</span><input type="number" min={0} step={1} value={v.maxBalance} placeholder="No cap" onChange={(e) => setV({ ...v, maxBalance: e.target.value })} /></label>}
        <label><span>Usable after (days from start)</span><input type="number" min={0} max={730} step={1} value={v.waitingDays} onChange={(e) => setV({ ...v, waitingDays: e.target.value })} /></label>
      </div>
      <fieldset className="days"><legend>Who gets it (none checked = everyone)</legend>
        {EMPLOYMENT_TYPES.map((t) => <label key={t} className="check"><input type="checkbox" checked={v.types.includes(t)} onChange={(e) => setV({ ...v, types: e.target.checked ? [...v.types, t] : v.types.filter((x) => x !== t) })} /> {TYPE_LABEL[t]}</label>)}
      </fieldset>
      <p className="muted">Hours-worked policies earn when timesheets are approved (salaried employees earn 40 hours’ worth a week). Accrual stops at the cap. Check your state’s paid sick leave rules: several require at least 1 hour per 30 worked.</p>
      {error && <p className="error" role="alert">{error}</p>}
    </Drawer>
  );
}

function AdjustDrawer({ employeeId, policyId, name, policy, onClose, onDone }: { employeeId: string; policyId: string; name: string; policy: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useRecords();
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  async function save() {
    try { await api('/api/time-off/adjust', 'POST', { employeeId, policyId, hours: Number(hours), note }); toast('Balance updated.'); onDone(); }
    catch (e) { setError((e as Error).message); }
  }
  return (
    <Drawer title={`Adjust ${policy}`} kicker={name} onClose={onClose} footer={<><button className="btn" onClick={save}>Save</button><button className="btn ghost" onClick={onClose}>Cancel</button></>}>
      <div className="form">
        <label><span>Hours (negative to take away)</span><input type="number" step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} autoFocus /></label>
        <label className="full"><span>Reason</span><input value={note} maxLength={300} placeholder="e.g. Starting balance, carryover, payout at year end" onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </Drawer>
  );
}
