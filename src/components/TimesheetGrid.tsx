'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRecords } from './Records';
import { hoursAmount } from '@/lib/payroll';
import type { TimesheetRow } from '@/lib/timesheets';

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const LABEL = { NOT_ENTERED: 'Not entered', DRAFT: 'Draft', APPROVED: 'Approved', PAID: 'Paid' } as const;
const PILL = { NOT_ENTERED: '', DRAFT: ' a', APPROVED: ' g', PAID: ' g' } as const;

type Draft = { reg: string; ot: string };

export default function TimesheetGrid({ week, prev, next, rows: initial, canEdit, admin, schedule, invoiced = {} }: {
  week: string; prev: string; next: string; rows: TimesheetRow[]; canEdit: boolean; admin: boolean; schedule?: boolean;
  invoiced?: Record<string, { id: string; number: string }>; // client id → this week's invoice
}) {
  const router = useRouter();
  const { toast } = useRecords();
  const [rows, setRows] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState('');
  const queue = useRef(new Map<string, Promise<void>>()); // one save at a time per row
  const pending = useRef(0); // saves in flight
  const saved = useRef(rows); saved.current = rows; // last saved values, read when a queued save actually runs
  useEffect(() => { if (pending.current === 0) { setRows(initial); setDrafts({}); } }, [initial]);

  // Live totals include hours typed but not yet saved.
  const live = useMemo(() => rows.map((r) => {
    const d = drafts[r.applicationId];
    if (!d) return r;
    const reg = Number(d.reg) || 0, ot = Number(d.ot) || 0;
    return { ...r, reg, ot, gross: hoursAmount(reg, ot, r.pay), billable: hoursAmount(reg, ot, r.bill) };
  }), [rows, drafts]);
  const sum = (k: 'reg' | 'ot' | 'gross' | 'billable') => live.reduce((s, r) => s + r[k], 0);
  const invoiceClients = useMemo(() => {
    const m = new Map<string, { name: string; total: number }>();
    for (const r of live) if (r.client && (r.status === 'APPROVED' || r.status === 'PAID')) {
      const c = m.get(r.client.id) ?? { name: r.client.name, total: 0 }; c.total += r.billable; m.set(r.client.id, c);
    }
    return [...m];
  }, [live]);

  const edit = (id: string, k: keyof Draft, v: string) => setDrafts((d) => {
    const r = rows.find((x) => x.applicationId === id)!;
    return { ...d, [id]: { reg: d[id]?.reg ?? (r.status === 'NOT_ENTERED' ? '' : String(r.reg)), ot: d[id]?.ot ?? (r.status === 'NOT_ENTERED' ? '' : String(r.ot)), [k]: v } };
  });

  // Saves run one at a time per row; the page refreshes only once nothing is in flight, so a slow
  // refresh from an earlier save can't overwrite hours typed after it.
  function save(r: TimesheetRow) {
    const id = r.applicationId;
    pending.current++;
    const run = (queue.current.get(id) ?? Promise.resolve()).then(() => saveNow(r)).finally(() => { if (--pending.current === 0) router.refresh(); });
    queue.current.set(id, run.catch(() => {}));
  }
  async function saveNow(r: TimesheetRow) {
    const d = drafts[r.applicationId];
    if (!d) return;
    const reg = Number(d.reg) || 0, ot = Number(d.ot) || 0;
    const clear = () => setDrafts((all) => {
      const cur = all[r.applicationId];
      if (!cur || cur.reg !== d.reg || cur.ot !== d.ot) return all; // edited again since: keep the newer draft
      const { [r.applicationId]: _, ...rest } = all; return rest;
    });
    // Compare with what's saved now (not the row as displayed, which already shows the typed hours).
    const base = saved.current.find((x) => x.applicationId === r.applicationId) ?? r;
    if (base.status !== 'NOT_ENTERED' && reg === base.reg && ot === base.ot) { clear(); return; }
    const res = await fetch('/api/timesheets', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationId: r.applicationId, week, regularHours: reg, overtimeHours: ot }) });
    if (!res.ok) { toast((await res.json().catch(() => ({}))).error ?? 'Could not save hours.', true); return; }
    const apply = (xs: TimesheetRow[]) => xs.map((x) => (x.applicationId === r.applicationId ? { ...x, reg, ot, status: 'DRAFT' as const, gross: hoursAmount(reg, ot, x.pay), billable: hoursAmount(reg, ot, x.bill) } : x));
    saved.current = apply(saved.current); // before React re-renders, so the next queued save sees it
    setRows(apply);
    clear();
  }

  async function act(action: 'approve' | 'markPaid' | 'reopen', applicationIds?: string[]) {
    if (applicationIds && !applicationIds.length) return toast(action === 'approve' ? 'No draft hours to approve.' : 'Nothing to update.');
    setBusy(action);
    const res = await fetch('/api/timesheets/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ week, action, applicationIds }) });
    setBusy('');
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast(j.error ?? 'Could not update timesheets.', true);
    toast(`${j.updated} timesheet${j.updated === 1 ? '' : 's'} ${action === 'approve' ? 'approved' : action === 'markPaid' ? 'marked paid' : 'reopened'}.`);
    router.refresh();
  }
  async function fillSchedule() {
    setBusy('schedule');
    const res = await fetch('/api/timesheets/fill-schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ week }) });
    setBusy('');
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast(j.error ?? 'Could not fill from the schedule.', true);
    const notes = [j.kept?.length ? `${j.kept.length} already had hours` : '', j.clocked?.length ? `${j.clocked.length} use the time clock` : ''].filter(Boolean).join('; ');
    toast(j.filled ? `Filled ${j.filled} timesheet${j.filled === 1 ? '' : 's'} from the schedule${notes ? ` (${notes})` : ''}. Check and approve them.` : `Nothing to fill${notes ? `: ${notes}` : ' — no scheduled shifts this week'}.`);
    router.refresh();
  }
  async function invoice(clientId: string) {
    setBusy(`inv-${clientId}`);
    const from = new Date(Date.parse(`${week}T00:00:00Z`) - 6 * 864e5).toISOString().slice(0, 10);
    const res = await fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, from, to: week }) });
    const j = await res.json().catch(() => ({}));
    setBusy('');
    if (!res.ok) return toast(j.error ?? 'Could not create the invoice.', true);
    router.push(`/app/invoices/${j.id}`);
  }
  const withHours = live.filter((r) => r.status === 'DRAFT' && r.reg + r.ot > 0).map((r) => r.applicationId);
  const hasApproved = live.some((r) => r.status === 'APPROVED');

  return (
    <>
      <div className="bar">
        <Link className="btn ghost" href={`?week=${prev}`} aria-label="Previous week">‹</Link>
        <b>Week ending {fmt(week)}</b>
        <Link className="btn ghost" href={`?week=${next}`} aria-label="Next week">›</Link>
        <span className="grow" />
        {canEdit && schedule && <button className="btn ghost" disabled={!!busy} onClick={fillSchedule} title="Fills blank timesheets with this week’s scheduled hours (over 40 goes to overtime)">Fill from schedule</button>}
        {admin && <>
          <button className="btn ghost" disabled={!!busy || Object.keys(drafts).length > 0} onClick={() => act('approve', withHours)}>Approve all with hours</button>
          <button className="btn ghost" disabled={!!busy || !hasApproved} onClick={() => act('markPaid')}>Mark approved as paid</button>
          <a className="btn ghost" href={`/api/payroll/export?week=${week}`}>Export payroll</a>
        </>}
      </div>
      <div className="kpis">
        <div className="kpi"><b>{rows.length}</b><span>On assignment</span></div>
        <div className="kpi"><b>{(sum('reg') + sum('ot')).toFixed(1)}</b><span>Hours this week</span></div>
        <div className="kpi"><b>{money(sum('gross'))}</b><span>Gross payroll</span></div>
        <div className="kpi"><b>{money(sum('billable'))}</b><span>Billable</span></div>
        <div className="kpi"><b>{money(sum('billable') - sum('gross'))}</b><span>Gross profit before burden</span></div>
      </div>
      {rows.length ? (
        <div className="tablewrap" style={{ marginTop: 16 }}><table style={{ minWidth: 900 }}><thead><tr><th>Worker</th><th>Assignment</th><th>Pay / bill</th><th>Regular hrs</th><th>OT hrs</th><th>Gross pay</th><th>Billable</th><th>Status</th></tr></thead><tbody>
          {live.map((r) => {
            const d = drafts[r.applicationId];
            const locked = !canEdit || r.status === 'APPROVED' || r.status === 'PAID';
            const val = (k: keyof Draft) => d?.[k] ?? (r.status === 'NOT_ENTERED' ? '' : String(r[k]));
            return (
              <tr key={r.applicationId}>
                <td><b>{r.worker}</b><div className="muted">{r.email}</div></td>
                <td>{r.job}<div className="muted">{r.client?.name}</div></td>
                <td>{money(r.pay)} / {money(r.bill)}</td>
                {(['reg', 'ot'] as const).map((k) => (
                  <td key={k}><input type="number" inputMode="decimal" min={0} max={168} step={0.25} style={{ width: 84 }} value={val(k)} disabled={locked}
                    aria-label={`${k === 'reg' ? 'Regular' : 'Overtime'} hours for ${r.worker}`}
                    onChange={(e) => edit(r.applicationId, k, e.target.value)} onBlur={() => save(r)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></td>
                ))}
                <td>{money(r.gross)}</td>
                <td>{money(r.billable)}</td>
                <td>
                  <span className={`pill${PILL[r.status]}`}>{LABEL[r.status]}</span>
                  {admin && r.status === 'DRAFT' && r.reg + r.ot > 0 && <button className="btn ghost sm" style={{ marginLeft: 6 }} onClick={() => act('approve', [r.applicationId])}>Approve</button>}
                  {admin && r.status === 'APPROVED' && <button className="btn ghost sm" style={{ marginLeft: 6 }} onClick={() => act('reopen', [r.applicationId])}>Reopen</button>}
                </td>
              </tr>
            );
          })}
        </tbody></table></div>
      ) : <div className="card empty"><b>No one on assignment</b>Candidates placed on contract, temp or per diem jobs show up here each week.</div>}
      {admin && invoiceClients.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Client invoices for this week</h2>
          <p className="muted">Built from approved hours, with worker, hours, rate, overtime and a due date from each client’s payment terms. Email them and record payments on the <Link href="/app/invoices">Invoices</Link> page.</p>
          <div className="row">{invoiceClients.map(([id, c]) => invoiced[id]
            ? <Link key={id} className="btn ghost" href={`/app/invoices/${invoiced[id].id}`}>{c.name}: {invoiced[id].number}</Link>
            : <button key={id} className="btn ghost" disabled={!!busy} onClick={() => invoice(id)}>Create invoice: {c.name} — {money(c.total)}</button>)}</div>
        </div>
      )}
    </>
  );
}
