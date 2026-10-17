'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords } from './Records';
import { DEDUCTION_TYPES, type DeductionType } from '@/lib/deductions';

type Row = { id: string; worker: string; type: string; label: string; code: string; pretax: boolean; amountType: 'FIXED' | 'PERCENT'; amount: number; annualLimit: number | null; employerAmount: number | null; startDate: string; endDate: string | null; active: boolean; syncedToProvider: boolean };
const fmt = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const today = () => new Date().toISOString().slice(0, 10);

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Try again.');
  return json;
}

/** Recurring paycheck deductions, taken automatically in every payroll run. */
export default function Deductions({ rows, workers, viaCheck }: { rows: Row[]; workers: { id: string; name: string }[]; viaCheck: boolean }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [adding, setAdding] = useState(false);
  const [showEnded, setShowEnded] = useState(false);
  const [ending, setEnding] = useState<string | null>(null);
  const [endOn, setEndOn] = useState(today());
  async function end(id: string) {
    try { await api(`/api/payroll/deductions/${id}`, 'PATCH', { endDate: endOn }); toast('Deduction ended.'); setEnding(null); router.refresh(); } catch (e) { toast((e as Error).message, true); }
  }
  const shown = rows.filter((r) => showEnded || r.active);
  return (
    <section className="card" id="deductions">
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Recurring deductions</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Benefit premiums and retirement contributions taken from every paycheck. They’re added to each payroll run automatically: pre-tax ones lower taxable wages, after-tax ones come out of net pay.
        {viaCheck ? ' They’re also set up on the employee in Check when you send a run, and Check takes them each payroll.' : ''} Wage garnishments aren’t handled here; keep them with your payroll provider.
      </p>
      {shown.length ? (
        <div className="tablewrap"><table>
          <thead><tr><th>Worker</th><th>Deduction</th><th>Per pay run</th><th>Dates</th><th></th></tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.id}>
              <td>{r.worker}</td>
              <td>{r.label} <span className={`pill ${r.pretax ? 'g' : ''}`}>{r.pretax ? 'Pre-tax' : 'After-tax'}</span><div className="muted">code {r.code}{r.syncedToProvider ? ' · in Check' : ''}</div></td>
              <td>{r.amountType === 'PERCENT' ? `${r.amount}% of gross` : `$${r.amount.toFixed(2)}`}{r.annualLimit !== null && <div className="muted">up to ${r.annualLimit.toFixed(2)} a year</div>}{r.employerAmount ? <div className="muted">company adds ${r.employerAmount.toFixed(2)}</div> : null}</td>
              <td>From {fmt(r.startDate)}{r.endDate ? <div className="muted">ends {fmt(r.endDate)}</div> : null}</td>
              <td>{r.active && (ending === r.id
                ? <span className="row" style={{ marginTop: 0 }}><input type="date" value={endOn} onChange={(e) => setEndOn(e.target.value)} aria-label="Last date it applies" style={{ width: 'auto' }} /><button className="btn sm danger" onClick={() => end(r.id)}>End</button><button className="btn ghost sm" onClick={() => setEnding(null)}>Cancel</button></span>
                : <button className="btn ghost sm" onClick={() => { setEnding(r.id); setEndOn(today()); }}>End…</button>)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <p className="muted">No recurring deductions yet.</p>}
      <div className="row">
        {!adding && <button className="btn ghost" onClick={() => setAdding(true)}>+ Add a deduction</button>}
        {rows.some((r) => !r.active) && <label className="muted"><input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} /> Show ended</label>}
      </div>
      {adding && <AddDeduction workers={workers} onDone={() => { setAdding(false); router.refresh(); }} onCancel={() => setAdding(false)} />}
    </section>
  );
}

function AddDeduction({ workers, onDone, onCancel }: { workers: { id: string; name: string }[]; onDone: () => void; onCancel: () => void }) {
  const { toast } = useRecords();
  const [f, setF] = useState({ candidateId: '', type: 'MEDICAL' as DeductionType, label: '', code: '', amountType: 'FIXED' as 'FIXED' | 'PERCENT', amount: '', annualLimit: '', employerAmount: '', startDate: today(), endDate: '' });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const t = DEDUCTION_TYPES[f.type];
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const n = (v: string) => (v === '' ? null : Number(v));
  async function save() {
    setBusy(true); setError('');
    try {
      await api('/api/payroll/deductions', 'POST', { ...f, label: f.label || null, code: f.code || null, amount: f.amount === '' ? NaN : Number(f.amount), annualLimit: n(f.annualLimit), employerAmount: n(f.employerAmount), endDate: f.endDate || null });
      toast('Deduction added. Draft runs were updated.'); onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="subform">
      <div className="form payform">
        <label><span>Worker</span><select value={f.candidateId} onChange={set('candidateId')}><option value="">Choose…</option>{workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <label><span>Kind</span><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as DeductionType, code: '' })}>{Object.entries(DEDUCTION_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label} ({v.pretax ? 'pre-tax' : 'after-tax'})</option>)}</select></label>
        {f.type === 'OTHER' && <label><span>Name</span><input value={f.label} maxLength={60} onChange={set('label')} placeholder="e.g. Uniform rental" /></label>}
        <label><span>Amount</span><span className="row" style={{ marginTop: 0, flexWrap: 'nowrap' }}>
          <select value={f.amountType} onChange={(e) => setF({ ...f, amountType: e.target.value as 'FIXED' | 'PERCENT' })} aria-label="Amount type" style={{ width: 'auto' }}><option value="FIXED">$ per pay run</option><option value="PERCENT">% of gross pay</option></select>
          <input type="number" min={0} step={0.01} inputMode="decimal" value={f.amount} onChange={set('amount')} aria-label="Amount" /></span></label>
        <label><span>Annual limit ($, optional)</span><input type="number" min={0} step={0.01} value={f.annualLimit} onChange={set('annualLimit')} placeholder={f.type === 'RETIREMENT_401K' || f.type === 'ROTH_401K' ? 'the IRS limit for the year' : ''} /></label>
        <label><span>Company contribution per run ($, optional)</span><input type="number" min={0} step={0.01} value={f.employerAmount} onChange={set('employerAmount')} /></label>
        <label><span>Starts (pay dates on or after)</span><input type="date" value={f.startDate} onChange={set('startDate')} /></label>
        <label><span>Ends (optional)</span><input type="date" value={f.endDate} onChange={set('endDate')} /></label>
        <label><span>Code in import files</span><input value={f.code} maxLength={12} onChange={set('code')} placeholder={t.code} /></label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row"><button className="btn sm" onClick={save} disabled={busy}>Add deduction</button><button className="btn ghost sm" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}
