'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRecords } from './Records';
import type { PremiumJson } from '@/lib/differentials-server';

type Rule = { id: string; name: string; kind: string; mode: string; timed: boolean; pay: number; bill: number };
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? 'Something went wrong. Try again.');
  return j;
}

/** One worker's premium hours for the week: add from the differentials that apply, or work them out from the time clock. */
export default function PremiumPanel({ applicationId, week, worker, canEdit, clock, admin, onChange }: { applicationId: string; week: string; worker: string; canEdit: boolean; clock: boolean; admin: boolean; onChange: () => void }) {
  const { toast } = useRecords();
  const [data, setData] = useState<{ lines: PremiumJson[]; rules: Rule[] } | null>(null);
  const [form, setForm] = useState({ ruleId: '', hours: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const j = await call(`/api/timesheets/premiums?applicationId=${applicationId}&week=${week}`, 'GET'); setData(j); setForm((f) => ({ ...f, ruleId: f.ruleId || j.rules[0]?.id || '' })); }
    catch (e) { toast((e as Error).message, true); }
  }, [applicationId, week, toast]);
  useEffect(() => { load(); }, [load]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast(ok); await load(); onChange(); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  if (!data) return <p className="muted">Loading…</p>;
  const rule = data.rules.find((r) => r.id === form.ruleId);
  return (
    <div className="subform" aria-label={`Premiums for ${worker}`}>
      {data.lines.length ? <table><thead><tr><th>Premium</th><th>Hours</th><th>Extra pay / hr</th><th>Extra bill / hr</th><th></th></tr></thead><tbody>
        {data.lines.map((l) => <tr key={l.id}>
          <td>{l.label}{l.auto && <span className="muted"> · from time clock</span>}{!l.inRegularRate && <div className="muted" style={{ fontSize: 12 }}>Not in the overtime rate (a 1.5× weekend/holiday premium)</div>}</td>
          <td>{l.hours}</td><td>{money(l.payPerHour)}</td><td>{money(l.billPerHour)}</td>
          <td>{canEdit && <button className="btn ghost sm" disabled={busy} onClick={() => run(() => call(`/api/timesheets/premiums/${l.id}`, 'DELETE'), 'Removed.')}>Remove</button>}</td>
        </tr>)}
      </tbody></table> : <p className="muted" style={{ marginTop: 0 }}>No premiums this week.</p>}
      {canEdit && (data.rules.length ? (
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>Differential<select value={form.ruleId} onChange={(e) => setForm({ ...form, ruleId: e.target.value })}>{data.rules.map((r) => <option key={r.id} value={r.id}>{r.name} (+{money(r.pay)}/hr{r.mode === 'FLAT' ? ', separate hours' : ''})</option>)}</select></label>
          <label>Hours<input type="number" inputMode="decimal" min={0} max={168} step={0.25} style={{ width: 90 }} value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} /></label>
          <button className="btn sm" disabled={busy || !form.ruleId || !(Number(form.hours) > 0)} onClick={() => run(() => call('/api/timesheets/premiums', 'POST', { applicationId, week, ruleId: form.ruleId, hours: Number(form.hours) }), `Added ${form.hours}h ${rule?.name ?? ''}.`).then(() => setForm({ ...form, hours: '' }))}>Add</button>
          {clock && data.rules.some((r) => r.timed) && <button className="btn ghost sm" disabled={busy} onClick={() => run(() => call('/api/timesheets/premiums/calculate', 'POST', { applicationId, week }), 'Worked out from the time clock.')} title="Night, weekend and holiday hours from this week’s punches">Work out from time clock</button>}
        </div>
      ) : <p className="muted">No differentials apply to this job yet.{admin && <> <Link href="/app/timesheets/differentials">Set them up</Link>.</>}</p>)}
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Night, charge, on-call and incentive pay raise the regular rate, so overtime hours earn a little more on top (FLSA). That’s included in gross pay automatically.</p>
    </div>
  );
}
