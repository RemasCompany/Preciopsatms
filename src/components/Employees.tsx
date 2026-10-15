'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Drawer from './Drawer';
import { useRecords } from './Records';
import { EMPLOYMENT_TYPES, STATUS_LABEL, TYPE_LABEL, fmtDate, money } from '@/lib/people-shared';
import type { EmployeeRow } from '@/lib/people';

type Opt = { id: string; name: string };
type Person = { id: string; name: string; title: string };
type PayRow = { id: string; effectiveDate: string; payType: 'HOURLY' | 'SALARY'; payRate: number; title: string | null; reason: string | null };

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Try again.');
  return json;
}
// The user's own calendar date (not UTC, which is already tomorrow in the US evening).
const today = () => new Date().toLocaleDateString('en-CA');
const PILL: Record<string, string> = { ACTIVE: 'g', ON_LEAVE: 'a', TERMINATED: '' };

export default function Employees({ rows, everyone, departments, branches, canEdit, admin }: {
  rows: EmployeeRow[]; everyone: Person[]; departments: Opt[]; branches: Opt[]; canEdit: boolean; admin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [depts, setDepts] = useState(false);
  return (
    <>
      {canEdit && (
        <div className="bar">
          {admin && <button className="btn" onClick={() => setAdding(true)}>+ Add employee</button>}
          {admin && <button className="btn ghost" onClick={() => setDepts(true)}>Departments</button>}
          <span className="grow" />
        </div>
      )}
      {rows.length ? (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Name</th><th>Department</th><th>Location</th><th>Manager</th><th>Type</th><th>Started</th>{admin && <th>Pay</th>}<th>Status</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id} className="clickrow" tabIndex={0} onClick={() => setOpen(e.id)} onKeyDown={(k) => k.key === 'Enter' && setOpen(e.id)}>
                <td><b>{e.name}</b><div className="muted">{e.title}{e.employeeNumber ? ` · #${e.employeeNumber}` : ''}</div></td>
                <td>{e.department ?? <span className="muted">—</span>}</td><td>{e.location ?? <span className="muted">—</span>}</td>
                <td>{e.manager ?? <span className="muted">—</span>}{e.reports > 0 && <div className="muted">{e.reports} report{e.reports === 1 ? '' : 's'}</div>}</td>
                <td>{TYPE_LABEL[e.employmentType]}</td><td>{fmtDate(e.startDate)}</td>
                {admin && <td>{e.payType && e.payRate !== null ? money(e.payRate, e.payType) : '—'}</td>}
                <td><span className={`pill ${PILL[e.status]}`}>{STATUS_LABEL[e.status]}</span>{e.endDate && <div className="muted">{e.status === 'TERMINATED' ? 'Left' : 'Last day'} {fmtDate(e.endDate)}</div>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className="card empty"><b>No employees here</b>{admin ? 'Add your team with “Add employee”, or hire someone through the pipeline — moving them to Hired adds them here.' : 'Try a different filter.'}</div>
      )}
      {adding && <AddEmployee everyone={everyone} departments={departments} branches={branches} onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); router.refresh(); setOpen(id); }} />}
      {depts && <Departments onClose={() => { setDepts(false); router.refresh(); }} />}
      {open && <EmployeeDrawer id={open} everyone={everyone} departments={departments} branches={branches} canEdit={canEdit} admin={admin} onClose={() => setOpen(null)} onChanged={() => router.refresh()} />}
    </>
  );
}

function JobFields({ v, set, everyone, departments, branches, self }: { v: Record<string, string>; set: (k: string, x: string) => void; everyone: Person[]; departments: Opt[]; branches: Opt[]; self?: string }) {
  return <>
    <label><span>Job title *</span><input value={v.title ?? ''} maxLength={120} onChange={(e) => set('title', e.target.value)} /></label>
    <label><span>Employment type</span><select value={v.employmentType ?? 'FULL_TIME'} onChange={(e) => set('employmentType', e.target.value)}>{EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></label>
    <label><span>Department</span><select value={v.departmentId ?? ''} onChange={(e) => set('departmentId', e.target.value)}><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    <label><span>Location</span><select value={v.branchId ?? ''} onChange={(e) => set('branchId', e.target.value)}><option value="">—</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
    <label><span>Manager</span><select value={v.managerId ?? ''} onChange={(e) => set('managerId', e.target.value)}><option value="">— No manager —</option>{everyone.filter((p) => p.id !== self).map((p) => <option key={p.id} value={p.id}>{p.name} — {p.title}</option>)}</select></label>
    <label><span>Employee #</span><input value={v.employeeNumber ?? ''} maxLength={40} onChange={(e) => set('employeeNumber', e.target.value)} /></label>
    <label><span>Work email</span><input type="email" value={v.workEmail ?? ''} onChange={(e) => set('workEmail', e.target.value)} /></label>
    <label><span>Start date</span><input type="date" value={v.startDate ?? ''} onChange={(e) => set('startDate', e.target.value)} /></label>
  </>;
}
const blankToNull = (v: Record<string, string>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, v[k] ? v[k] : null]));

function AddEmployee({ everyone, departments, branches, onClose, onDone }: { everyone: Person[]; departments: Opt[]; branches: Opt[]; onClose: () => void; onDone: (id: string) => void }) {
  const { toast } = useRecords();
  const [v, setV] = useState<Record<string, string>>({ employmentType: 'FULL_TIME', startDate: today(), payType: 'HOURLY' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, x: string) => setV({ ...v, [k]: x });
  async function save() {
    setBusy(true); setError('');
    try {
      const r = await api('/api/employees', 'POST', { name: v.name, email: v.email ?? '', phone: v.phone, title: v.title, employmentType: v.employmentType, startDate: v.startDate,
        employeeNumber: v.employeeNumber, workEmail: v.workEmail ?? '', payType: v.payType, payRate: v.payRate, ...blankToNull(v, ['departmentId', 'branchId', 'managerId']) });
      toast(`${v.name} added.`); onDone(r.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Add employee" onClose={onClose} footer={<><button className="btn" onClick={save} disabled={busy}>Add employee</button><button className="btn ghost" onClick={onClose}>Cancel</button></>}>
      <div className="form">
        <label className="full"><span>Full name *</span><input value={v.name ?? ''} maxLength={120} onChange={(e) => set('name', e.target.value)} autoFocus /></label>
        <label><span>Personal email</span><input type="email" value={v.email ?? ''} onChange={(e) => set('email', e.target.value)} /></label>
        <label><span>Mobile phone</span><input type="tel" value={v.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></label>
        <JobFields v={v} set={set} everyone={everyone} departments={departments} branches={branches} />
        <label><span>Paid</span><select value={v.payType} onChange={(e) => set('payType', e.target.value)}><option value="HOURLY">Hourly</option><option value="SALARY">Salary</option></select></label>
        <label><span>{v.payType === 'SALARY' ? 'Annual salary ($)' : 'Hourly rate ($)'} *</span><input type="number" min={0} step="0.01" inputMode="decimal" value={v.payRate ?? ''} onChange={(e) => set('payRate', e.target.value)} /></label>
      </div>
      <p className="muted">Hourly employees get timesheets and overtime; salaried employees are paid their salary and left out of timesheets. They can be scheduled and use the time clock either way. Pay is visible to owners and admins only.</p>
      {error && <p className="error" role="alert">{error}</p>}
    </Drawer>
  );
}

type Detail = { employee: EmployeeRow; reports: Person[]; pay: PayRow[] | null };

function EmployeeDrawer({ id, everyone, departments, branches, canEdit, admin, onClose, onChanged }: {
  id: string; everyone: Person[]; departments: Opt[]; branches: Opt[]; canEdit: boolean; admin: boolean; onClose: () => void; onChanged: () => void;
}) {
  const { toast, open: openRecord } = useRecords();
  const [d, setD] = useState<Detail | null>(null);
  const [v, setV] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<'view' | 'pay' | 'end'>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const r: Detail = await api(`/api/employees/${id}`, 'GET'); setD(r);
      const e = r.employee;
      setV({ name: e.name, email: e.email ?? '', phone: e.phone ?? '', title: e.title, employmentType: e.employmentType, departmentId: e.departmentId ?? '', branchId: e.branchId ?? '',
        managerId: e.managerId ?? '', employeeNumber: e.employeeNumber ?? '', workEmail: e.workEmail ?? '', startDate: e.startDate });
    } catch (err) { toast((err as Error).message, true); onClose(); }
  }, [id, toast, onClose]);
  useEffect(() => { load(); }, [load]);
  const set = (k: string, x: string) => setV({ ...v, [k]: x });
  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setError('');
    try { toast(await fn()); setMode('view'); await load(); onChanged(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  if (!d) return <Drawer title="Loading…" onClose={onClose}><p className="muted">Loading…</p></Drawer>;
  const e = d.employee;
  const ended = e.status === 'TERMINATED';
  const save = () => run(async () => {
    await api(`/api/employees/${id}`, 'PATCH', { name: v.name, email: v.email, phone: v.phone, title: v.title, employmentType: v.employmentType, employeeNumber: v.employeeNumber, workEmail: v.workEmail, startDate: v.startDate, ...blankToNull(v, ['departmentId', 'branchId', 'managerId']) });
    return 'Saved.';
  });
  const leave = (status: 'ACTIVE' | 'ON_LEAVE') => run(async () => { await api(`/api/employees/${id}`, 'PATCH', { status }); return status === 'ON_LEAVE' ? `${e.name} is on leave.` : `${e.name} is back from leave.`; });

  return (
    <Drawer title={e.name} kicker={`${e.title}${e.department ? ` · ${e.department}` : ''}`} onClose={onClose} footer={canEdit && !ended && mode === 'view' ? <>
      <button className="btn" onClick={save} disabled={busy}>Save changes</button>
      <button className="btn ghost" onClick={() => openRecord('candidates', e.candidateId)}>Documents & credentials</button>
      <button className="btn ghost" disabled={busy} onClick={() => run(async () => {
        const r = await api(`/api/employees/${id}/portal`, 'POST', { channels: ['email', 'sms'] });
        if (!r.sent.length) throw new Error(`Couldn’t send it: ${r.problems.join('; ') || 'add an email or mobile number first'}.`);
        return `Sent ${e.name} their employee page by ${r.sent.map((c: string) => (c === 'sms' ? 'text' : 'email')).join(' and ')}.`;
      })} title="Email and text a private link: their schedule, time clock, time off, pay summaries and documents">Send employee page</button>
      <span style={{ flex: 1 }} />
      {admin && <button className="btn danger" onClick={() => setMode('end')}>End employment</button>}
    </> : undefined}>
      <p><span className={`pill ${PILL[e.status]}`}>{STATUS_LABEL[e.status]}</span> <span className="muted">{TYPE_LABEL[e.employmentType]} · started {fmtDate(e.startDate)}{e.endDate ? ` · ${ended ? 'left' : 'last day'} ${fmtDate(e.endDate)}` : ''}</span></p>
      {ended && e.endReason && <p className="muted">Reason: {e.endReason}</p>}
      {mode === 'end' ? <EndForm name={e.name} busy={busy} onCancel={() => setMode('view')} onSubmit={(b) => run(async () => {
        const r = await api(`/api/employees/${id}/terminate`, 'POST', b);
        return r.effective ? `${e.name}’s employment has ended${r.removedShifts ? `; ${r.removedShifts} later shift${r.removedShifts === 1 ? '' : 's'} came off the schedule` : ''}. Their checklist is on the Offboarding page.` : `Saved. ${e.name}’s last day is ${fmtDate(b.endDate)}; their checklist is on the Offboarding page.`;
      })} /> : mode === 'pay' ? <PayForm e={e} busy={busy} onCancel={() => setMode('view')} onSubmit={(b) => run(async () => {
        const r = await api(`/api/employees/${id}/pay`, 'POST', b);
        return r.applied ? 'Pay updated.' : `Saved. The new pay starts ${fmtDate(String(b.effectiveDate))}.`;
      })} /> : <>
        {canEdit && !ended && (
          <div className="row" style={{ marginBottom: 8 }}>
            {e.status === 'ACTIVE' ? <button className="btn ghost sm" onClick={() => leave('ON_LEAVE')} disabled={busy}>Put on leave</button> : <button className="btn ghost sm" onClick={() => leave('ACTIVE')} disabled={busy}>Back from leave</button>}
          </div>
        )}
        <div className="form">
          <label className="full"><span>Full name</span><input value={v.name ?? ''} readOnly={!canEdit || ended} onChange={(x) => set('name', x.target.value)} /></label>
          <label><span>Personal email</span><input type="email" value={v.email ?? ''} readOnly={!canEdit || ended} onChange={(x) => set('email', x.target.value)} /></label>
          <label><span>Mobile phone</span><input type="tel" value={v.phone ?? ''} readOnly={!canEdit || ended} onChange={(x) => set('phone', x.target.value)} /></label>
          {canEdit && !ended ? <JobFields v={v} set={set} everyone={everyone} departments={departments} branches={branches} self={e.id} /> : <>
            <label><span>Manager</span><input readOnly value={e.manager ?? '—'} /></label><label><span>Location</span><input readOnly value={e.location ?? '—'} /></label>
          </>}
        </div>
        {d.reports.length > 0 && <section className="sec"><h3>Direct reports <span className="muted">{d.reports.length}</span></h3><div className="list">{d.reports.map((r) => <div key={r.id} className="li"><span className="x"><b>{r.name}</b><span className="muted">{r.title}</span></span></div>)}</div></section>}
        {d.pay && (
          <section className="sec"><h3>Pay {admin && !ended && <button className="btn ghost sm" onClick={() => setMode('pay')}>Change pay</button>}</h3>
            {e.payType && e.payRate !== null && <p><b style={{ fontSize: 18 }}>{money(e.payRate, e.payType)}</b> <span className="muted">{e.payType === 'SALARY' ? 'salaried — not on timesheets' : 'hourly — paid from timesheets, overtime at 1.5×'}</span></p>}
            <div className="tablewrap"><table><thead><tr><th>Effective</th><th>Pay</th><th>Title</th><th>Reason</th></tr></thead>
              <tbody>{d.pay.map((p) => <tr key={p.id}><td>{fmtDate(p.effectiveDate)}{p.effectiveDate > today() && <div className="muted">upcoming</div>}</td><td>{money(p.payRate, p.payType)}</td><td>{p.title ?? '—'}</td><td>{p.reason ?? '—'}</td></tr>)}</tbody></table></div>
          </section>
        )}
      </>}
      {error && <p className="error" role="alert">{error}</p>}
    </Drawer>
  );
}

function PayForm({ e, busy, onCancel, onSubmit }: { e: EmployeeRow; busy: boolean; onCancel: () => void; onSubmit: (b: Record<string, unknown>) => void }) {
  const [v, setV] = useState({ effectiveDate: today(), payType: e.payType ?? 'HOURLY', payRate: String(e.payRate ?? ''), title: '', reason: '' });
  const pct = e.payRate && e.payType === v.payType && Number(v.payRate) ? ((Number(v.payRate) - e.payRate) / e.payRate) * 100 : null;
  return (
    <section className="sec"><h3>Change pay</h3>
      <div className="form">
        <label><span>Effective date</span><input type="date" value={v.effectiveDate} onChange={(x) => setV({ ...v, effectiveDate: x.target.value })} /></label>
        <label><span>Paid</span><select value={v.payType} onChange={(x) => setV({ ...v, payType: x.target.value as 'HOURLY' | 'SALARY' })}><option value="HOURLY">Hourly</option><option value="SALARY">Salary</option></select></label>
        <label><span>{v.payType === 'SALARY' ? 'Annual salary ($)' : 'Hourly rate ($)'}</span><input type="number" min={0} step="0.01" value={v.payRate} onChange={(x) => setV({ ...v, payRate: x.target.value })} /></label>
        <label><span>New title (promotion)</span><input value={v.title} maxLength={120} placeholder="Leave blank to keep it" onChange={(x) => setV({ ...v, title: x.target.value })} /></label>
        <label className="full"><span>Reason</span><input value={v.reason} maxLength={300} placeholder="e.g. Annual raise, promotion, market adjustment" onChange={(x) => setV({ ...v, reason: x.target.value })} /></label>
      </div>
      {pct !== null && <p className="muted">{pct >= 0 ? '+' : ''}{pct.toFixed(1)}% from {money(e.payRate!, e.payType!)}.</p>}
      <div className="row"><button className="btn" disabled={busy} onClick={() => onSubmit({ ...v, title: v.title || null })}>Save pay change</button><button className="btn ghost" onClick={onCancel}>Cancel</button></div>
    </section>
  );
}

function EndForm({ name, busy, onCancel, onSubmit }: { name: string; busy: boolean; onCancel: () => void; onSubmit: (b: { endDate: string; reason: string; rehire: boolean }) => void }) {
  const [v, setV] = useState({ endDate: today(), reason: '', rehire: true });
  return (
    <section className="sec"><h3>End {name}’s employment</h3>
      <div className="form">
        <label><span>Last day</span><input type="date" value={v.endDate} onChange={(x) => setV({ ...v, endDate: x.target.value })} /></label>
        <label><span>Reason</span><select value={v.reason} onChange={(x) => setV({ ...v, reason: x.target.value })}><option value="">Choose…</option>{['Resigned', 'Retired', 'End of season or contract', 'Laid off', 'Terminated for cause', 'Did not return from leave', 'Other'].map((r) => <option key={r}>{r}</option>)}</select></label>
        <label className="check full"><input type="checkbox" checked={v.rehire} onChange={(x) => setV({ ...v, rehire: x.target.checked })} /> Eligible for rehire</label>
      </div>
      <p className="muted">Their shifts after the last day come off the schedule (any they were told about go out as cancellations), their direct reports move to their manager, and they stop counting toward billing. Records, documents and pay history are kept.{!v.rehire && ' They’re also added to the company-wide do-not-rehire list.'}</p>
      <div className="row"><button className="btn danger" disabled={busy || !v.reason} onClick={() => onSubmit(v)}>End employment</button><button className="btn ghost" onClick={onCancel}>Cancel</button></div>
    </section>
  );
}

function Departments({ onClose }: { onClose: () => void }) {
  const { toast } = useRecords();
  const [list, setList] = useState<{ id: string; name: string; _count: { employees: number } }[] | null>(null);
  const [name, setName] = useState('');
  const load = useCallback(async () => setList(await api('/api/departments', 'GET')), []);
  useEffect(() => { load().catch((e) => toast((e as Error).message, true)); }, [load, toast]);
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); await load(); } catch (e) { toast((e as Error).message, true); } };
  return (
    <Drawer title="Departments" onClose={onClose}>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) act(() => api('/api/departments', 'POST', { name }), `${name} added.`).then(() => setName('')); }}>
        <input value={name} maxLength={80} placeholder="e.g. Warehouse, Front desk, Nursing" onChange={(e) => setName(e.target.value)} aria-label="New department" style={{ flex: 1 }} />
        <button className="btn">Add</button>
      </form>
      <div className="list" style={{ marginTop: 12 }}>
        {list?.map((d) => (
          <div key={d.id} className="li"><span className="x"><b>{d.name}</b><span className="muted">{d._count.employees} employee{d._count.employees === 1 ? '' : 's'}</span></span>
            <span className="row">
              <button className="btn ghost sm" onClick={() => { const n = prompt('Rename department', d.name); if (n?.trim() && n.trim() !== d.name) act(() => api(`/api/departments/${d.id}`, 'PATCH', { name: n }), 'Renamed.'); }}>Rename</button>
              <button className="btn ghost sm" aria-label={`Delete ${d.name}`} onClick={() => { if (confirm(`Delete ${d.name}?${d._count.employees ? ` Its ${d._count.employees} employee${d._count.employees === 1 ? '' : 's'} will have no department.` : ''}`)) act(() => api(`/api/departments/${d.id}`, 'DELETE'), 'Deleted.'); }}>✕</button>
            </span></div>
        ))}
        {list && !list.length && <p className="muted">No departments yet.</p>}
      </div>
    </Drawer>
  );
}
