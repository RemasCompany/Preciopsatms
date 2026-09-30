'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords } from './Records';
import { ADJUSTMENTS, EXPORT_FORMATS, FREQUENCIES, totals as sumUp, type AdjustmentKind, type Check, type ExportFormat, type RunItem } from '@/lib/payroll-run';

type Totals = ReturnType<typeof sumUp>;
const money = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const fmt = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00Z` : s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok && !json.needsAcknowledge) throw new Error(json.error ?? 'Something went wrong. Try again.');
  return json;
}

export function NewPayrollRun({ defaultEnd }: { defaultEnd: string }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [frequency, setFrequency] = useState<keyof typeof FREQUENCIES>('WEEKLY');
  const [periodEnd, setPeriodEnd] = useState(defaultEnd);
  const [payDate, setPayDate] = useState(addDays(defaultEnd, 5));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const start = periodEnd ? addDays(periodEnd, frequency === 'BIWEEKLY' ? -13 : -6) : '';
  const sunday = periodEnd && new Date(`${periodEnd}T00:00:00Z`).getUTCDay() === 0;
  async function go() {
    setBusy(true); setError('');
    try {
      const r = await api('/api/payroll/runs', 'POST', { frequency, periodEnd, payDate });
      toast(`${r.number} started with ${r.included} approved timesheet${r.included === 1 ? '' : 's'}.`);
      router.push(`/app/payroll/${r.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return (
    <div className="card">
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Start a payroll run</h2>
      <div className="form payform">
        <label><span>Pay frequency</span><select value={frequency} onChange={(e) => setFrequency(e.target.value as keyof typeof FREQUENCIES)}>{Object.entries(FREQUENCIES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label><span>Period ends (Sunday)</span><input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></label>
        <label><span>Pay date</span><input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></label>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>{sunday ? `Covers ${fmt(start)} – ${fmt(periodEnd)}: every approved timesheet in that period that isn’t already in a run.` : 'Pay periods end on a Sunday, like your timesheet weeks.'}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" onClick={go} disabled={busy || !sunday || !payDate}>{busy ? 'Starting…' : 'Start run'}</button>
    </div>
  );
}

export function PayrollSettings({ provider, companyCode }: { provider: string | null; companyCode: string | null }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [p, setP] = useState(provider ?? 'csv');
  const [code, setCode] = useState(companyCode ?? '');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api('/api/payroll/settings', 'PATCH', { provider: p, companyCode: code || null }); toast('Payroll settings saved.'); router.refresh(); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  return (
    <div className="card">
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Payroll provider</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Exports default to this layout. Map the earning codes (REG, OT, BON, OTH, REIMB, DED) once in your provider’s import settings, and add each worker’s payroll employee ID on their candidate record.</p>
      <div className="form payform">
        <label><span>Provider</span><select value={p} onChange={(e) => setP(e.target.value)}>{Object.entries(EXPORT_FORMATS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label><span>Company code (if your provider uses one)</span><input value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} placeholder="e.g. ADP Co Code" /></label>
      </div>
      <button className="btn ghost" onClick={save} disabled={busy}>Save</button>
    </div>
  );
}

type RunInfo = { id: string; number: string; periodStart: string; periodEnd: string; payDate: string; status: 'DRAFT' | 'APPROVED' | 'PAID' | 'VOID'; frequency: string; approvedAt: string | null; paidAt: string | null };
const STATUS = { DRAFT: ['a', 'Draft'], APPROVED: ['', 'Approved'], PAID: ['g', 'Paid'], VOID: ['r', 'Void'] } as const;

export default function PayrollRunView({ run, workers, totals, checks, clients, provider, canEdit }: {
  run: RunInfo; workers: RunItem[][]; totals: Totals; checks: Check[]; clients: [string, string][]; provider: string | null; canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useRecords();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [format, setFormat] = useState<ExportFormat>((provider as ExportFormat) ?? 'csv');
  const [pending, setPending] = useState<Check[] | null>(null);
  const draft = run.status === 'DRAFT', exportable = run.status === 'APPROVED' || run.status === 'PAID';
  const warns = checks.filter((c) => c.level === 'warn');

  async function act(action: 'refresh' | 'approve' | 'unapprove' | 'pay' | 'void', acknowledge = false) {
    const ask = { void: 'Void this run? Its timesheets are released so they can go in a new run.', pay: 'Mark this run paid? Do this after your provider has processed it. Paid runs can’t be changed.', unapprove: 'Reopen this run for changes? Re-export it after approving again.' } as Record<string, string>;
    if (ask[action] && !confirm(ask[action])) return;
    setBusy(true);
    try {
      const r = await api(`/api/payroll/runs/${run.id}`, 'PATCH', { action, acknowledge });
      if (r.needsAcknowledge) { setPending(r.warnings); return; }
      setPending(null);
      toast({ refresh: `Refreshed: ${r.included} timesheet${r.included === 1 ? '' : 's'} in the run${r.dropped ? `, ${r.dropped} removed (reopened)` : ''}.`, approve: 'Run approved. Export it for your payroll provider.', unapprove: 'Run reopened.', pay: 'Run marked paid.', void: 'Run voided.' }[action]);
      router.refresh();
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  async function removeAdj(id: string) {
    try { await api(`/api/payroll/adjustments/${id}`, 'DELETE'); router.refresh(); } catch (e) { toast((e as Error).message, true); }
  }

  return (
    <>
      <div className="runhead">
        <div>
          <h1 style={{ marginBottom: 2 }}>{run.number} <span className={`pill ${STATUS[run.status][0]}`}>{STATUS[run.status][1]}</span></h1>
          <p className="muted" style={{ margin: 0 }}>{fmt(run.periodStart)} – {fmt(run.periodEnd)} · pay date {fmt(run.payDate)} · {run.frequency === 'BIWEEKLY' ? 'every two weeks' : 'weekly'}{run.paidAt ? ` · paid ${fmt(run.paidAt)}` : run.approvedAt ? ` · approved ${fmt(run.approvedAt)}` : ''}</p>
        </div>
        {canEdit && (
          <div className="row" style={{ marginTop: 0 }}>
            {draft && <button className="btn ghost" disabled={busy} onClick={() => act('refresh')}>Refresh from timesheets</button>}
            {draft && <button className="btn" disabled={busy || !workers.length} onClick={() => act('approve')}>Approve run</button>}
            {run.status === 'APPROVED' && <button className="btn ghost" disabled={busy} onClick={() => act('unapprove')}>Reopen</button>}
            {run.status === 'APPROVED' && <button className="btn" disabled={busy} onClick={() => act('pay')}>Mark paid</button>}
            {(draft || run.status === 'APPROVED') && <button className="btn danger" disabled={busy} onClick={() => act('void')}>Void</button>}
          </div>
        )}
      </div>

      <div className="kpis" style={{ margin: '16px 0' }}>
        <div className="kpi"><b>{workers.length}</b><span>Workers</span></div>
        <div className="kpi"><b>{+totals.hours.toFixed(2)}</b><span>Hours</span><span className="sub">{+totals.overtimeHours.toFixed(2)} overtime</span></div>
        <div className="kpi"><b>{money(totals.gross)}</b><span>Gross pay</span><span className="sub">{money(totals.wages)} wages{totals.extraTaxable ? ` + ${money(totals.extraTaxable)} bonuses` : ''}</span></div>
        <div className="kpi"><b>{money(totals.reimbursements)}</b><span>Reimbursements</span></div>
        <div className="kpi"><b>{money(totals.deductions)}</b><span>Deductions</span></div>
        <div className="kpi"><b>{money(totals.billable)}</b><span>Billable</span><span className="sub">{money(totals.margin)} gross margin</span></div>
      </div>

      {pending && (
        <div className="card warnbox" role="alert">
          <b>Check these before approving</b>
          <ul>{pending.map((c) => <li key={c.text}>{c.text}</li>)}</ul>
          <div className="row"><button className="btn ghost" onClick={() => setPending(null)}>Go back and fix</button><button className="btn danger" disabled={busy} onClick={() => act('approve', true)}>Approve anyway</button></div>
        </div>
      )}
      {!pending && checks.length > 0 && draft && (
        <div className={`card ${warns.length ? 'warnbox' : 'infobox'}`}>
          <b>{warns.length ? `${warns.length} thing${warns.length === 1 ? '' : 's'} to fix` : 'Before you approve'}</b>
          <ul>{checks.map((c) => <li key={c.text} className={c.level === 'warn' ? 'warn' : undefined}>{c.text}</li>)}</ul>
        </div>
      )}

      {exportable && (
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Send to payroll and bill clients</h2>
          <div className="row" style={{ marginTop: 0 }}>
            <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)} aria-label="Export format">{Object.entries(EXPORT_FORMATS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <a className="btn" href={`/api/payroll/runs/${run.id}/export?format=${format}`}>Download export</a>
            <a className="btn ghost" href={`/api/payroll/runs/${run.id}/statements`}>Pay summaries (PDF)</a>
          </div>
          {clients.length > 0 && <div className="row">{clients.map(([id, name]) => <a key={id} className="btn ghost sm" href={`/api/payroll/runs/${run.id}/invoice?client=${id}`}>Invoice {name}</a>)}</div>}
          <p className="muted" style={{ fontSize: 13 }}>Import the export into your provider, let it calculate taxes and pay, then come back and mark this run paid.</p>
        </div>
      )}

      {workers.length ? (
        <div className="list payworkers">{workers.map((items) => {
          const w = items[0], t = sumUp(items);
          return (
            <section key={w.candidateId} className="card payworker">
              <div className="payworkerhead">
                <div><b>{w.workerName}</b><span className="muted">{w.payrollId ? `Employee ID ${w.payrollId}` : 'No payroll employee ID'}</span></div>
                <div className="paytotal"><b>{money(t.gross)}</b><span className="muted">gross{t.reimbursements ? ` · +${money(t.reimbursements)} reimb.` : ''}{t.deductions ? ` · −${money(t.deductions)} ded.` : ''}</span></div>
              </div>
              <div className="tablewrap scroll"><table className="paylines">
                <thead><tr><th>Assignment</th><th>Week ending</th><th>Reg hrs</th><th>OT hrs</th><th>Rate</th><th>Wages</th></tr></thead>
                <tbody>{items.map((i) => (
                  <tr key={i.id}><td>{i.position}<div className="muted">{i.clientName ?? '—'}</div></td><td>{fmt(i.weekEnding)}</td><td>{i.regularHours.toFixed(2)}</td><td>{i.overtimeHours.toFixed(2)}</td><td>{usd(i.payRate)}</td><td>{usd(i.regularPay + i.overtimePay)}</td></tr>
                ))}</tbody>
              </table></div>
              {items.some((i) => i.adjustments.length) && (
                <ul className="adjlist">{items.flatMap((i) => i.adjustments.map((a) => (
                  <li key={a.id}><span className={`pill ${a.kind === 'DEDUCTION' ? 'r' : a.kind === 'REIMBURSEMENT' ? '' : 'g'}`}>{ADJUSTMENTS[a.kind].label}</span> {a.description}<b>{a.kind === 'DEDUCTION' ? '−' : '+'}{usd(a.amount)}</b>
                    {draft && canEdit && <button className="btn ghost sm" onClick={() => removeAdj(a.id)} aria-label={`Remove ${a.description}`}>✕</button>}</li>
                )))}</ul>
              )}
              {draft && canEdit && (adding === w.candidateId
                ? <AdjustmentForm runId={run.id} itemId={items[0].id} onDone={() => { setAdding(null); router.refresh(); }} onCancel={() => setAdding(null)} />
                : <button className="btn ghost sm" onClick={() => setAdding(w.candidateId)}>+ Bonus, reimbursement or deduction</button>)}
            </section>
          );
        })}</div>
      ) : <div className="card empty"><b>No approved hours in this period</b>Approve timesheets on Timesheets & payroll, then refresh this run.</div>}
    </>
  );
}

function AdjustmentForm({ runId, itemId, onDone, onCancel }: { runId: string; itemId: string; onDone: () => void; onCancel: () => void }) {
  const [kind, setKind] = useState<AdjustmentKind>('BONUS');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    try { await api(`/api/payroll/runs/${runId}/adjustments`, 'POST', { itemId, kind, description, amount }); onDone(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="subform">
      <div className="form">
        <label><span>Type</span><select value={kind} onChange={(e) => setKind(e.target.value as AdjustmentKind)}>{Object.entries(ADJUSTMENTS).map(([v, a]) => <option key={v} value={v}>{a.label}{a.taxable ? ' (taxable)' : v === 'REIMBURSEMENT' ? ' (not taxed)' : ' (after tax)'}</option>)}</select></label>
        <label><span>Amount ($)</span><input type="number" min={0.01} step={0.01} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="full"><span>Description</span><input value={description} maxLength={120} onChange={(e) => setDescription(e.target.value)} placeholder={kind === 'REIMBURSEMENT' ? 'e.g. Mileage, 42 miles' : kind === 'DEDUCTION' ? 'e.g. Pay advance repayment' : 'e.g. Referral bonus'} /></label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row"><button className="btn sm" onClick={save} disabled={busy}>Add</button><button className="btn ghost sm" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}
