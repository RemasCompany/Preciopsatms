'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords } from './Records';
import { REMIT_FIELDS, REQ_FIELDS, VMS, type VmsKind } from '@/lib/vms';

type Program = {
  id: string; clientId: string; clientName: string | null; vms: VmsKind; vmsLabel: string; idLabel: string; workerIdLabel: string; hint: string; name: string; supplierCode: string | null;
  feePct: number; rateCodes: { regular: string; overtime: string }; timeColumns: { field: string; label: string; header: string }[]; jobs: number; lastImportAt: string | null;
};
const money = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const lastSunday = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() || 7)); return d.toISOString().slice(0, 10); };

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Try again.');
  return json;
}

export default function VmsPrograms({ clients, canAdmin }: { clients: { id: string; name: string }[]; canAdmin: boolean }) {
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // The setup checklist links to #add.
  useEffect(() => { const on = () => { if (location.hash === '#add') setAdding(true); }; on(); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on); }, []);
  const load = useCallback(() => api('/api/vms/programs', 'GET').then((r) => { setPrograms(r.programs); setOpen((o) => o ?? r.programs[0]?.id ?? null); }).catch(() => setPrograms([])), []);
  useEffect(() => { load(); }, [load]);
  if (!programs) return <p className="muted">Loading…</p>;
  const prog = programs.find((p) => p.id === open);
  return (
    <>
      <div className="row" style={{ marginTop: 0, flexWrap: 'wrap' }}>
        {programs.map((p) => <button key={p.id} className={`btn ${p.id === open ? '' : 'ghost'}`} onClick={() => setOpen(p.id)}>{p.name}<span style={{ fontWeight: 400, opacity: 0.85 }}> · {p.vmsLabel}</span></button>)}
        {canAdmin && <button className="btn ghost" onClick={() => setAdding(true)}>+ Add a program</button>}
      </div>
      {adding && canAdmin && <NewProgram clients={clients} onDone={(id) => { setAdding(false); setOpen(id); load(); }} onCancel={() => setAdding(false)} />}
      {!programs.length && !adding && (
        <div className="card empty"><b>No VMS programs yet</b>Add one for each client that runs its contingent workforce through SAP Fieldglass, Beeline, Workday VNDLY or another VMS. You’ll import their requisitions, send approved time in their upload format, and match their remittances to your invoices.</div>
      )}
      {prog && <ProgramPanel key={prog.id} p={prog} canAdmin={canAdmin} onChanged={load} onDeleted={() => { setOpen(null); load(); }} />}
    </>
  );
}

function NewProgram({ clients, onDone, onCancel }: { clients: { id: string; name: string }[]; onDone: (id: string) => void; onCancel: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ clientId: '', vms: 'fieldglass' as VmsKind, name: '', supplierCode: '', feePct: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setError('');
    try { const r = await api('/api/vms/programs', 'POST', { ...f, feePct: f.feePct || 0, name: f.name || `${clients.find((c) => c.id === f.clientId)?.name ?? 'Client'} ${VMS[f.vms].label}` }); onDone(r.id); router.refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="card">
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Add a VMS program</h2>
      <div className="form payform">
        <label><span>Client</span><select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })}><option value="">Choose…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label><span>VMS</span><select value={f.vms} onChange={(e) => setF({ ...f, vms: e.target.value as VmsKind })}>{Object.entries(VMS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label><span>Program name</span><input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Harbor Point Fieldglass" /></label>
        <label><span>Our supplier ID in their VMS</span><input value={f.supplierCode} maxLength={40} onChange={(e) => setF({ ...f, supplierCode: e.target.value })} /></label>
        <label><span>VMS fee (%)</span><input type="number" min={0} max={20} step={0.01} inputMode="decimal" value={f.feePct} onChange={(e) => setF({ ...f, feePct: e.target.value })} placeholder="e.g. 2.5" /></label>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>{VMS[f.vms].hint}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row"><button className="btn" onClick={save} disabled={busy || !f.clientId}>Add program</button><button className="btn ghost" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

const TABS = { reqs: 'Requisitions', placements: 'Placements', time: 'Approved time', remit: 'Remittances', settings: 'Settings' } as const;

function ProgramPanel({ p, canAdmin, onChanged, onDeleted }: { p: Program; canAdmin: boolean; onChanged: () => void; onDeleted: () => void }) {
  const [tab, setTab] = useState<keyof typeof TABS>('reqs');
  // The setup checklist links to #tab-<name>.
  useEffect(() => {
    const on = () => { const t = location.hash.slice(5) as keyof typeof TABS; if (location.hash.startsWith('#tab-') && t in TABS) { setTab(t); document.getElementById('program')?.scrollIntoView({ behavior: 'smooth' }); } };
    on(); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on);
  }, []);
  return (
    <section className="card" id="program">
      <h2 style={{ marginTop: 0, fontSize: 18 }}>{p.name} <span className="pill">{p.vmsLabel}</span></h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{p.clientName}{p.supplierCode ? ` · supplier ID ${p.supplierCode}` : ''}{p.feePct ? ` · ${p.feePct}% VMS fee` : ''} · {p.jobs} job{p.jobs === 1 ? '' : 's'}{p.lastImportAt ? ` · last import ${new Date(p.lastImportAt).toLocaleDateString()}` : ''}</p>
      <div className="tabs" role="tablist">{(Object.keys(TABS) as (keyof typeof TABS)[]).filter((t) => canAdmin || (t !== 'settings' && t !== 'reqs' && t !== 'remit')).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={`btn sm ${tab === t ? '' : 'ghost'}`} onClick={() => setTab(t)}>{TABS[t]}</button>)}</div>
      {tab === 'reqs' && <Requisitions p={p} onDone={onChanged} />}
      {tab === 'placements' && <Placements p={p} />}
      {tab === 'time' && <Time p={p} />}
      {tab === 'remit' && <Remittance p={p} />}
      {tab === 'settings' && <Settings p={p} onChanged={onChanged} onDeleted={onDeleted} />}
    </section>
  );
}

function FilePick({ label, onText }: { label: string; onText: (text: string, name: string) => void }) {
  return (
    <label className="filepick"><span>{label}</span>
      <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) onText(await f.text(), f.name); e.target.value = ''; }} />
    </label>
  );
}

function ColumnPicker<F extends string>({ fields, headers, columns, onPick }: { fields: Record<F, { label: string; required: boolean }>; headers: string[]; columns: Record<F, string | null>; onPick: (f: F, col: string) => void }) {
  return (
    <details className="colmap" open={Object.entries(fields).some(([f, d]) => (d as { required: boolean }).required && !columns[f as F])}>
      <summary>Columns: {Object.keys(fields).filter((f) => columns[f as F]).length} of {Object.keys(fields).length} matched — change</summary>
      <div className="form payform">{(Object.keys(fields) as F[]).map((f) => (
        <label key={f}><span>{fields[f].label}{fields[f].required ? ' *' : ''}</span>
          <select value={columns[f] ?? ''} onChange={(e) => onPick(f, e.target.value)}><option value="">(not in this file)</option>{headers.map((h) => <option key={h} value={h}>{h}</option>)}</select></label>
      ))}</div>
      <p className="muted" style={{ fontSize: 12 }}>Your choices are saved for this program when you import.</p>
    </details>
  );
}

const ACT = { new: ['g', 'New job'], update: ['', 'Update'], same: ['', 'No change'], skip: ['r', 'Skipped'] } as const;
type Plan = { headers: string[]; columns: Record<string, string | null>; missing: string[]; truncated: boolean; counts: Record<string, number>; rows: { line: number; reqId: string; title: string; location: string | null; openings: number | null; billRate: number | null; status: string | null; action: keyof typeof ACT; changes: string[]; problems: string[] }[] };

function Requisitions({ p, onDone }: { p: Program; onDone: () => void }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [text, setText] = useState(''), [name, setName] = useState('');
  const [mapping, setMapping] = useState<Record<string, string> | undefined>(undefined);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const preview = useCallback(async (t: string, m?: Record<string, string>) => {
    setBusy(true); setError('');
    try { setPlan(await api(`/api/vms/programs/${p.id}/requisitions`, 'POST', { text: t, mapping: m })); } catch (e) { setError((e as Error).message); setPlan(null); } finally { setBusy(false); }
  }, [p.id]);
  async function commit() {
    setBusy(true);
    try {
      const r = await api(`/api/vms/programs/${p.id}/requisitions`, 'POST', { text, mapping: mapping ?? (plan ? Object.fromEntries(Object.entries(plan.columns).map(([k, v]) => [k, v ?? ''])) : undefined), commit: true });
      toast(`Imported: ${r.new} new job${r.new === 1 ? '' : 's'}, ${r.update} updated.`); setPlan(null); setText(''); onDone(); router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const pick = (f: string, col: string) => { const m = { ...Object.fromEntries(Object.entries(plan!.columns).map(([k, v]) => [k, v ?? ''])), ...mapping, [f]: col }; setMapping(m); preview(text, m); };
  return (
    <div>
      <p className="muted" style={{ fontSize: 13 }}>Export open requisitions from {p.vmsLabel} as CSV and choose the file. New requisitions become jobs for {p.clientName} (not posted publicly); changes to rates, positions, dates and status update the matching job.</p>
      <FilePick label="Requisition export (CSV)" onText={(t, n) => { setText(t); setName(n); setMapping(undefined); preview(t); }} />
      {error && <p className="error" role="alert">{error}</p>}
      {plan && (
        <>
          <p><b>{name}</b>: {plan.counts.new} new · {plan.counts.update} to update · {plan.counts.same} unchanged{plan.counts.skip ? ` · ${plan.counts.skip} skipped` : ''}{plan.truncated ? ' · only the first 2,000 rows' : ''}</p>
          <ColumnPicker fields={REQ_FIELDS} headers={plan.headers} columns={plan.columns as never} onPick={pick} />
          {plan.missing.length > 0 && <p className="error">Choose the column for: {plan.missing.join(', ')}.</p>}
          <div className="tablewrap scroll"><table>
            <thead><tr><th>Row</th><th>Requisition</th><th>Title</th><th>Location</th><th>Positions</th><th>Bill rate</th><th>Status</th><th></th></tr></thead>
            <tbody>{plan.rows.slice(0, 200).map((r) => (
              <tr key={r.line}><td>{r.line}</td><td>{r.reqId || '—'}</td><td>{r.title || '—'}</td><td>{r.location ?? ''}</td><td>{r.openings ?? ''}</td><td>{r.billRate !== null ? `$${r.billRate.toFixed(2)}` : ''}</td><td>{r.status ?? ''}</td>
                <td><span className={`pill ${ACT[r.action][0]}`}>{ACT[r.action][1]}</span>{r.changes.length ? <div className="muted" style={{ fontSize: 12 }}>{r.changes.join(', ')}</div> : null}{r.problems.length ? <div className="error" style={{ fontSize: 12 }}>{r.problems.join(' ')}</div> : null}</td></tr>
            ))}</tbody>
          </table></div>
          <div className="row"><button className="btn" disabled={busy || !!plan.missing.length || !(plan.counts.new + plan.counts.update)} onClick={commit}>{busy ? 'Importing…' : `Import ${plan.counts.new + plan.counts.update} requisition${plan.counts.new + plan.counts.update === 1 ? '' : 's'}`}</button></div>
        </>
      )}
    </div>
  );
}

function Placements({ p }: { p: Program }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [rows, setRows] = useState<{ id: string; worker: string; job: string; reqId: string | null; workOrderId: string | null; workerId: string | null }[] | null>(null);
  useEffect(() => { api(`/api/vms/programs/${p.id}/placements`, 'GET').then((r) => setRows(r.placements)).catch(() => setRows([])); }, [p.id]);
  async function save(applicationId: string, field: 'workOrderId' | 'workerId', value: string, was: string | null) {
    if ((value || null) === was) return;
    try { await api(`/api/vms/programs/${p.id}/placements`, 'PATCH', { applicationId, [field]: value }); setRows((rs) => rs!.map((r) => (r.id === applicationId ? { ...r, [field]: value || null } : r))); toast('Saved.'); router.refresh(); }
    catch (e) { toast((e as Error).message, true); }
  }
  if (!rows) return <p className="muted">Loading…</p>;
  if (!rows.length) return <p className="muted">Nobody is placed on this program’s jobs yet. Move candidates to Placed in the pipeline.</p>;
  return (
    <>
      <p className="muted" style={{ fontSize: 13 }}>Copy each placement’s {p.idLabel} from {p.vmsLabel}. Time files match on it, so a placement without one is left out of the upload.</p>
      <div className="tablewrap scroll"><table>
        <thead><tr><th>Worker</th><th>Job</th><th>Requisition</th><th>{p.idLabel}</th><th>{p.workerIdLabel}</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}><td>{r.worker}</td><td>{r.job}</td><td>{r.reqId ?? '—'}</td>
            <td><input defaultValue={r.workOrderId ?? ''} maxLength={60} aria-label={`${p.idLabel} for ${r.worker}`} onBlur={(e) => save(r.id, 'workOrderId', e.target.value.trim(), r.workOrderId)} className={r.workOrderId ? '' : 'missing'} /></td>
            <td><input defaultValue={r.workerId ?? ''} maxLength={60} aria-label={`${p.workerIdLabel} for ${r.worker}`} onBlur={(e) => save(r.id, 'workerId', e.target.value.trim(), r.workerId)} /></td></tr>
        ))}</tbody>
      </table></div>
    </>
  );
}

function Time({ p }: { p: Program }) {
  const router = useRouter();
  const [week, setWeek] = useState(lastSunday());
  const [all, setAll] = useState(false);
  const [data, setData] = useState<{ rows: { timesheetId: string; worker: string; workOrderId: string | null; regularHours: number; overtimeHours: number; billRate: number; exportedAt: string | null }[]; pending: number } | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { setError(''); api(`/api/vms/programs/${p.id}/time?week=${week}`, 'GET').then(setData).catch((e) => { setData(null); setError(e.message); }); }, [p.id, week]);
  useEffect(() => { load(); }, [load]);
  const rows = data?.rows ?? [], use = rows.filter((r) => all || !r.exportedAt), missing = use.filter((r) => !r.workOrderId);
  const amount = use.filter((r) => r.workOrderId).reduce((s, r) => s + Math.round(r.regularHours * r.billRate * 100) + Math.round(r.overtimeHours * r.billRate * 1.5 * 100), 0);
  return (
    <div>
      <p className="muted" style={{ fontSize: 13 }}>Approved hours for this program’s jobs, in {p.vmsLabel}’s upload layout ({p.timeColumns.map((c) => c.header).join(', ')}). Upload the file in {p.vmsLabel}; the client approves there and the VMS bills it.</p>
      <div className="row"><label>Week ending <input type="date" value={week} onChange={(e) => setWeek(e.target.value)} style={{ width: 'auto' }} /></label>
        <label className="muted"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Include timesheets already sent</label></div>
      {error && <p className="error" role="alert">{error}</p>}
      {data && (rows.length ? (
        <>
          <div className="tablewrap scroll"><table>
            <thead><tr><th>Worker</th><th>{p.idLabel}</th><th>Regular</th><th>Overtime</th><th>Bill rate</th><th>Sent</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.timesheetId}><td>{r.worker}</td><td>{r.workOrderId ?? <span className="error">Missing</span>}</td><td>{r.regularHours.toFixed(2)}</td><td>{r.overtimeHours.toFixed(2)}</td><td>${r.billRate.toFixed(2)}</td><td>{r.exportedAt ? new Date(r.exportedAt).toLocaleDateString() : '—'}</td></tr>)}</tbody>
          </table></div>
          {missing.length > 0 && <p className="error">{missing.length} timesheet{missing.length === 1 ? '' : 's'} will be left out until you add the {p.idLabel} on Placements.</p>}
          {data.pending > 0 && <p className="muted">{data.pending} timesheet{data.pending === 1 ? ' is' : 's are'} still a draft this week and not included.</p>}
          {use.length - missing.length > 0
            ? <a className="btn" href={`/api/vms/programs/${p.id}/time?week=${week}&download=1${all ? '&all=1' : ''}`} onClick={() => setTimeout(() => { load(); router.refresh(); }, 1500)}>Download time file ({use.length - missing.length} timesheet{use.length - missing.length === 1 ? '' : 's'}, {money(amount)})</a>
            : <p className="muted">Everything approved this week was already sent.</p>}
        </>
      ) : <p className="muted">No approved hours for this program’s jobs that week.</p>)}
    </div>
  );
}

const RACT = { pay: ['g', 'Record payment'], paid: ['', 'Already paid'], duplicate: ['', 'Already recorded'], not_found: ['r', 'No such invoice'], over: ['r', 'More than owed'], skip: ['r', 'Skipped'] } as const;
type RPlan = { headers: string[]; columns: Record<string, string | null>; missing: string[]; counts: Record<string, number>; totalCents: number; feeCents: number; rows: { line: number; invoice: string; paidOn: string | null; reference: string | null; action: keyof typeof RACT; balance: number | null; paidCents: number; feeCents: number; problems: string[] }[] };

function Remittance({ p }: { p: Program }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [text, setText] = useState(''), [mapping, setMapping] = useState<Record<string, string> | undefined>(undefined);
  const [plan, setPlan] = useState<RPlan | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const preview = async (t: string, m?: Record<string, string>) => {
    setBusy(true); setError('');
    try { setPlan(await api(`/api/vms/programs/${p.id}/remittance`, 'POST', { text: t, mapping: m })); } catch (e) { setError((e as Error).message); setPlan(null); } finally { setBusy(false); }
  };
  async function commit() {
    setBusy(true);
    try {
      const r = await api(`/api/vms/programs/${p.id}/remittance`, 'POST', { text, mapping: mapping ?? Object.fromEntries(Object.entries(plan!.columns).map(([k, v]) => [k, v ?? ''])), commit: true });
      toast(`Recorded ${r.recorded} payment${r.recorded === 1 ? '' : 's'} (${money(r.totalCents)}${r.feeCents ? ` plus ${money(r.feeCents)} VMS fees` : ''}).`); setPlan(null); setText(''); router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const pick = (f: string, col: string) => { const m = { ...Object.fromEntries(Object.entries(plan!.columns).map(([k, v]) => [k, v ?? ''])), ...mapping, [f]: col }; setMapping(m); preview(text, m); };
  return (
    <div>
      <p className="muted" style={{ fontSize: 13 }}>Choose the remittance advice from {p.vmsLabel} (CSV). Each line is matched to your invoice for {p.clientName} by number and recorded as a payment. {p.feePct ? `When a payment is short by the ${p.feePct}% VMS fee, the fee is recorded too so the invoice closes.` : 'Set the VMS fee in Settings to close invoices short-paid by the fee.'}</p>
      <FilePick label="Remittance (CSV)" onText={(t) => { setText(t); setMapping(undefined); preview(t); }} />
      {error && <p className="error" role="alert">{error}</p>}
      {plan && (
        <>
          <p>{plan.counts.pay} to record ({money(plan.totalCents)}{plan.feeCents ? ` + ${money(plan.feeCents)} fees` : ''}){plan.counts.not_found ? ` · ${plan.counts.not_found} not matched` : ''}{plan.counts.duplicate + plan.counts.paid ? ` · ${plan.counts.duplicate + plan.counts.paid} already done` : ''}</p>
          <ColumnPicker fields={REMIT_FIELDS} headers={plan.headers} columns={plan.columns as never} onPick={pick} />
          {plan.missing.length > 0 && <p className="error">Choose the column for: {plan.missing.join(', ')}.</p>}
          <div className="tablewrap scroll"><table>
            <thead><tr><th>Row</th><th>Invoice</th><th>Owed</th><th>Paid</th><th>VMS fee</th><th>Date</th><th></th></tr></thead>
            <tbody>{plan.rows.slice(0, 300).map((r) => (
              <tr key={r.line}><td>{r.line}</td><td>{r.invoice || '—'}</td><td>{r.balance !== null ? money(r.balance) : '—'}</td><td>{money(r.paidCents)}</td><td>{r.feeCents ? money(r.feeCents) : ''}</td><td>{r.paidOn ?? ''}</td>
                <td><span className={`pill ${RACT[r.action][0]}`}>{RACT[r.action][1]}</span>{r.problems.length ? <div className="error" style={{ fontSize: 12 }}>{r.problems.join(' ')}</div> : null}</td></tr>
            ))}</tbody>
          </table></div>
          <button className="btn" disabled={busy || !!plan.missing.length || !plan.counts.pay} onClick={commit}>{busy ? 'Recording…' : `Record ${plan.counts.pay} payment${plan.counts.pay === 1 ? '' : 's'}`}</button>
        </>
      )}
    </div>
  );
}

function Settings({ p, onChanged, onDeleted }: { p: Program; onChanged: () => void; onDeleted: () => void }) {
  const { toast } = useRecords();
  const [f, setF] = useState({ name: p.name, supplierCode: p.supplierCode ?? '', feePct: String(p.feePct || ''), regular: p.rateCodes.regular, overtime: p.rateCodes.overtime });
  const [cols, setCols] = useState<Record<string, string>>(Object.fromEntries(p.timeColumns.map((c) => [c.field, c.header])));
  const [error, setError] = useState(''), [confirmDel, setConfirmDel] = useState(false);
  async function save() {
    setError('');
    try {
      await api(`/api/vms/programs/${p.id}`, 'PATCH', { name: f.name, supplierCode: f.supplierCode || null, feePct: f.feePct || 0, rateCodes: { regular: f.regular, overtime: f.overtime }, mappings: { time: cols } });
      toast('Program saved.'); onChanged();
    } catch (e) { setError((e as Error).message); }
  }
  async function del() {
    try { await api(`/api/vms/programs/${p.id}`, 'DELETE'); toast('Program removed. Its jobs were kept.'); onDeleted(); } catch (e) { toast((e as Error).message, true); }
  }
  return (
    <div>
      <div className="form payform">
        <label><span>Program name</span><input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label><span>Our supplier ID</span><input value={f.supplierCode} maxLength={40} onChange={(e) => setF({ ...f, supplierCode: e.target.value })} /></label>
        <label><span>VMS fee (%)</span><input type="number" min={0} max={20} step={0.01} value={f.feePct} onChange={(e) => setF({ ...f, feePct: e.target.value })} /></label>
        <label><span>Straight-time rate code</span><input value={f.regular} maxLength={20} onChange={(e) => setF({ ...f, regular: e.target.value })} /></label>
        <label><span>Overtime rate code</span><input value={f.overtime} maxLength={20} onChange={(e) => setF({ ...f, overtime: e.target.value })} /></label>
      </div>
      <h3 style={{ fontSize: 15 }}>Time file column headers</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Match these to the upload template the program gave you. {p.hint}</p>
      <div className="form payform">{p.timeColumns.map((c) => <label key={c.field}><span>{c.label}</span><input value={cols[c.field] ?? ''} maxLength={80} onChange={(e) => setCols({ ...cols, [c.field]: e.target.value })} /></label>)}</div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row"><button className="btn" onClick={save}>Save</button>{!confirmDel ? <button className="btn ghost" onClick={() => setConfirmDel(true)}>Remove program</button>
        : <><span>Remove {p.name}? Its jobs stay.</span><button className="btn danger sm" onClick={del}>Remove</button><button className="btn ghost sm" onClick={() => setConfirmDel(false)}>Cancel</button></>}</div>
    </div>
  );
}
