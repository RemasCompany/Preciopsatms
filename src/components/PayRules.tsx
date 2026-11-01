'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MODES, RULE_KINDS, majorHolidays, type Mode, type RuleKind } from '@/lib/differentials';
import type { RuleJson } from '@/lib/differentials-server';

type Draft = { id?: string; name: string; kind: RuleKind; mode: Mode; pay: string; bill: string; scope: string; startTime: string; endTime: string; holidays: string };
const blank: Draft = { name: 'Night shift', kind: 'NIGHT', mode: 'ADD', pay: '3', bill: '4', scope: '', startTime: '19:00', endTime: '07:00', holidays: '' };
/** Common starting points. */
const PRESETS: [string, Partial<Draft>][] = [
  ['Night +$3', { name: 'Night shift', kind: 'NIGHT', mode: 'ADD', pay: '3', bill: '4.5', startTime: '19:00', endTime: '07:00' }],
  ['Weekend +$2', { name: 'Weekend', kind: 'WEEKEND', mode: 'ADD', pay: '2', bill: '3' }],
  ['Holiday 1.5×', { name: 'Holiday', kind: 'HOLIDAY', mode: 'MULTIPLY', pay: '1.5', bill: '1.5' }],
  ['On call $4/hr', { name: 'On call', kind: 'ON_CALL', mode: 'FLAT', pay: '4', bill: '6' }],
  ['Charge +$2', { name: 'Charge nurse', kind: 'CHARGE', mode: 'ADD', pay: '2', bill: '3' }],
  ['Crisis +$10', { name: 'Crisis incentive', kind: 'CRISIS', mode: 'ADD', pay: '10', bill: '15' }],
];
const money = (n: number) => `$${n.toFixed(2)}`;
const amount = (mode: string, n: number, side: 'pay' | 'bill') => (mode === 'MULTIPLY' ? (n ? `${n}× ${side}` : `no extra ${side}`) : `${money(n)}/hr ${side}`);

/** The company's pay differentials: add, change, turn off. */
export default function PayRules({ rules, clients, jobs, canEdit, staffing }: { rules: RuleJson[]; clients: { id: string; name: string }[]; jobs: { id: string; title: string }[]; canEdit: boolean; staffing: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const year = new Date().getFullYear();

  async function send(url: string, method: string, body: unknown, ok: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? 'Something went wrong. Try again.');
      setMsg({ ok: true, text: ok }); setDraft(null); router.refresh();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  function save(d: Draft) {
    const [kind, id] = d.scope.split(':');
    send(d.id ? `/api/pay-rules/${d.id}` : '/api/pay-rules', d.id ? 'PATCH' : 'POST', {
      name: d.name, kind: d.kind, mode: d.mode, pay: Number(d.pay), bill: staffing ? Number(d.bill) : 0, clientId: kind === 'client' ? id : null, jobId: kind === 'job' ? id : null,
      startTime: d.startTime || null, endTime: d.endTime || null, holidays: d.holidays.split(/[\s,]+/).filter(Boolean),
    }, 'Saved. New premium hours use it; weeks already entered keep their amounts.');
  }
  const edit = (r: RuleJson): Draft => ({ id: r.id, name: r.name, kind: r.kind, mode: r.mode, pay: String(r.pay), bill: String(r.bill), scope: r.jobId ? `job:${r.jobId}` : r.clientId ? `client:${r.clientId}` : '', startTime: r.startTime ?? '19:00', endTime: r.endTime ?? '07:00', holidays: r.holidays.join(', ') });

  return (
    <>
      {canEdit && !draft && <div className="row" style={{ flexWrap: 'wrap', marginBottom: 12 }}><button className="btn" onClick={() => setDraft(blank)}>+ Add differential</button>{PRESETS.map(([label, p]) => <button key={label} className="btn ghost sm" onClick={() => setDraft({ ...blank, ...p, holidays: p.kind === 'HOLIDAY' ? [...majorHolidays(year), ...majorHolidays(year + 1)].join(', ') : '' })}>{label}</button>)}</div>}
      {msg && <p className={msg.ok ? 'ok' : 'error'} role="status">{msg.text}</p>}
      {draft && (
        <div className="card subform">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label>Name<input value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label>Kind<select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as RuleKind })}>{Object.entries(RULE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Paid as<select value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as Mode })}>{Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label>{draft.mode === 'MULTIPLY' ? 'Pay multiplier' : 'Pay $ per hour'}<input type="number" inputMode="decimal" min={0} step={draft.mode === 'MULTIPLY' ? 0.05 : 0.25} value={draft.pay} onChange={(e) => setDraft({ ...draft, pay: e.target.value })} /></label>
            {staffing && <label>{draft.mode === 'MULTIPLY' ? 'Bill multiplier (0 = none)' : 'Bill $ per hour'}<input type="number" inputMode="decimal" min={0} step={draft.mode === 'MULTIPLY' ? 0.05 : 0.25} value={draft.bill} onChange={(e) => setDraft({ ...draft, bill: e.target.value })} /></label>}
            <label>Applies to<select value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value })}>
              <option value="">Every job</option>
              {clients.length > 0 && <optgroup label="One client">{clients.map((c) => <option key={c.id} value={`client:${c.id}`}>{c.name}</option>)}</optgroup>}
              {jobs.length > 0 && <optgroup label="One job">{jobs.map((j) => <option key={j.id} value={`job:${j.id}`}>{j.title}</option>)}</optgroup>}
            </select></label>
          </div>
          {draft.kind === 'NIGHT' && <div className="row"><label>Night starts<input type="time" value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} /></label><label>Ends<input type="time" value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} /></label></div>}
          {draft.kind === 'HOLIDAY' && <label>Holidays (dates, comma-separated)<textarea rows={2} value={draft.holidays} onChange={(e) => setDraft({ ...draft, holidays: e.target.value })} /><span className="muted" style={{ fontSize: 12 }}>Filled with New Year’s, Memorial Day, July 4th, Labor Day, Thanksgiving and Christmas for {year} and {year + 1}. Edit to match your contracts.</span></label>}
          {draft.mode === 'FLAT' && <p className="muted" style={{ margin: 0 }}>Flat-rate hours are paid on their own (e.g. hours on call but not called in) and aren’t counted as hours worked.</p>}
          <div className="row"><button className="btn sm" disabled={busy} onClick={() => save(draft)}>Save</button><button className="btn ghost sm" onClick={() => setDraft(null)}>Cancel</button></div>
        </div>
      )}
      {rules.length ? <div className="tablewrap"><table>
        <thead><tr><th>Differential</th><th>Amount</th><th>Applies to</th><th>Status</th><th></th></tr></thead>
        <tbody>{rules.map((r) => <tr key={r.id} className={r.active ? undefined : 'muted'}>
          <td><b>{r.name}</b><div className="muted">{RULE_KINDS[r.kind]}{r.kind === 'NIGHT' && r.startTime ? ` · ${r.startTime}–${r.endTime}` : ''}{r.kind === 'HOLIDAY' ? ` · ${r.holidays.length} dates` : ''}</div></td>
          <td>{amount(r.mode, r.pay, 'pay')}{staffing && <div className="muted">{amount(r.mode, r.bill, 'bill')}</div>}{r.mode === 'FLAT' && <div className="muted">separate hours</div>}</td>
          <td>{r.job ?? r.client ?? 'Every job'}</td>
          <td><span className={`pill ${r.active ? 'g' : ''}`}>{r.active ? 'On' : 'Off'}</span></td>
          <td>{canEdit && <span className="row" style={{ marginTop: 0 }}><button className="btn ghost sm" onClick={() => setDraft(edit(r))}>Change</button><button className="btn ghost sm" disabled={busy} onClick={() => send(`/api/pay-rules/${r.id}`, 'PATCH', { active: !r.active }, r.active ? 'Turned off.' : 'Turned on.')}>{r.active ? 'Turn off' : 'Turn on'}</button></span>}</td>
        </tr>)}</tbody>
      </table></div> : !draft && <div className="card empty"><b>No differentials yet</b>{canEdit ? 'Add one, or start from a common one above.' : 'An owner or admin can add them.'}</div>}
    </>
  );
}
