'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords } from './Records';
import { COVERAGE, type AcaPolicy, type Coverage } from '@/lib/aca';
import type { PersonRow } from '@/lib/aca-server';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmt = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—');
const STATUS = { full_time: ['g', 'Full-time'], measuring: ['a', 'New — measuring'], not_full_time: ['', 'Not full-time'], not_employed: ['', 'Not employed'] } as const;
const ACTION = { offer_now: ['r', 'Offer coverage now'], offer_soon: ['a', 'Offer coming up'], watch: ['', 'Close to 30 hours'] } as const;
const RESPONSE = { PENDING: 'No answer yet', ACCEPTED: 'Accepted', WAIVED: 'Declined' } as const;

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Try again.');
  return json;
}

type Filter = 'action' | 'full_time' | 'all';

export default function AcaTracking({ rows, policy, counts }: { rows: PersonRow[]; policy: AcaPolicy & { saved: boolean }; counts: { offerNow: number; offerSoon: number; watch: number; fullTime: number } }) {
  const [filter, setFilter] = useState<Filter>(counts.offerNow + counts.offerSoon + counts.watch ? 'action' : 'all');
  const [offering, setOffering] = useState<string | null>(null);
  const shown = rows.filter((r) => filter === 'all' || (filter === 'action' ? !!r.action : r.now?.status === 'full_time'));
  return (
    <>
      <div className="row" role="tablist" aria-label="Show">
        {([['action', `Needs attention (${counts.offerNow + counts.offerSoon + counts.watch})`], ['full_time', `Full-time now (${counts.fullTime})`], ['all', `Everyone (${rows.length})`]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={filter === k} className={`btn sm ${filter === k ? '' : 'ghost'}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      {shown.length ? (
        <div className="tablewrap"><table>
          <thead><tr><th>Worker</th><th>This month</th><th>Measuring now</th><th>Coverage offer</th><th></th></tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.candidateId}>
              <td><b>{r.name}</b><div className="muted">{r.now?.status === 'measuring' ? 'New employee · ' : ''}{r.start ? `working since ${fmt(r.start)}` : ''}</div></td>
              <td>{r.now ? <span className={`pill ${STATUS[r.now.status][0]}`} title={r.now.reason}>{STATUS[r.now.status][1]}</span> : '—'}{r.fullTimeThrough && <div className="muted">through {fmt(r.fullTimeThrough)}</div>}</td>
              <td>{r.current ? <>{r.current.average.toFixed(1)} h/week<div className="muted">{r.current.label.toLowerCase()} {fmt(r.current.period.start)} – {fmt(r.current.period.end)}</div></> : '—'}</td>
              <td>{r.offer ? <OfferCell offer={r.offer} /> : <span className="muted">None</span>}</td>
              <td>{r.action && <><span className={`pill ${ACTION[r.action][0]}`}>{ACTION[r.action][1]}</span><div className="muted" style={{ maxWidth: 260 }}>{r.actionText}</div></>}
                {offering === r.candidateId ? null : <button className="btn ghost sm" onClick={() => setOffering(r.candidateId)}>Record an offer</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <div className="card empty"><b>{filter === 'action' ? 'Nothing needs attention' : 'No one here yet'}</b>{filter === 'action' ? 'No one is full-time without an offer, or heading over 30 hours a week.' : 'People appear once they have approved timesheets.'}</div>}
      {offering && <OfferForm row={rows.find((r) => r.candidateId === offering)!} onDone={() => setOffering(null)} />}
      <PolicyForm policy={policy} />
    </>
  );
}

function OfferCell({ offer }: { offer: NonNullable<PersonRow['offer']> }) {
  const router = useRouter();
  const { toast } = useRecords();
  async function set(response: keyof typeof RESPONSE) {
    try { await api(`/api/aca/offers/${offer.id}`, 'PATCH', { response }); toast('Saved.'); router.refresh(); } catch (e) { toast((e as Error).message, true); }
  }
  return (
    <div>
      From {fmt(offer.coverageStart)} · {COVERAGE[offer.coverage].toLowerCase()} · ${offer.employeeCost.toFixed(2)}/mo
      <div><select aria-label="Their answer" value={offer.response} onChange={(e) => set(e.target.value as keyof typeof RESPONSE)} style={{ width: 'auto', marginTop: 4 }}>{Object.entries(RESPONSE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
    </div>
  );
}

function OfferForm({ row, onDone }: { row: PersonRow; onDone: () => void }) {
  const router = useRouter();
  const { toast } = useRecords();
  const today = new Date().toISOString().slice(0, 10);
  const firstOfNext = (() => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10); })();
  const [f, setF] = useState({ offeredOn: today, coverageStart: row.offerBy ?? (row.now?.status === 'full_time' ? `${today.slice(0, 7)}-01` : firstOfNext), coverageEnd: row.fullTimeThrough ?? '', coverage: 'FAMILY' as Coverage, minimumValue: true, employeeCost: '', response: 'PENDING', note: '' });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setError('');
    try {
      await api('/api/aca/offers', 'POST', { ...f, candidateId: row.candidateId, coverageEnd: f.coverageEnd || null, employeeCost: f.employeeCost === '' ? NaN : Number(f.employeeCost), note: f.note || null });
      toast(`Offer to ${row.name} recorded.`); onDone(); router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <section className="card" aria-label={`Offer to ${row.name}`}>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Record an offer of coverage to {row.name}</h2>
      <div className="form payform">
        <label><span>Offered on</span><input type="date" value={f.offeredOn} onChange={(e) => setF({ ...f, offeredOn: e.target.value })} /></label>
        <label><span>Coverage starts (the 1st)</span><input type="date" value={f.coverageStart} onChange={(e) => setF({ ...f, coverageStart: e.target.value })} /></label>
        <label><span>Coverage ends (if known)</span><input type="date" value={f.coverageEnd} onChange={(e) => setF({ ...f, coverageEnd: e.target.value })} /></label>
        <label><span>Offered to</span><select value={f.coverage} onChange={(e) => setF({ ...f, coverage: e.target.value as Coverage })}>{Object.entries(COVERAGE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label><span>Employee’s monthly cost, lowest-cost self-only plan ($)</span><input type="number" min={0} step={0.01} inputMode="decimal" value={f.employeeCost} onChange={(e) => setF({ ...f, employeeCost: e.target.value })} /></label>
        <label><span>Their answer</span><select value={f.response} onChange={(e) => setF({ ...f, response: e.target.value })}>{Object.entries(RESPONSE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="full checkbox"><input type="checkbox" checked={f.minimumValue} onChange={(e) => setF({ ...f, minimumValue: e.target.checked })} /> The plan provides minimum value (covers at least 60% of costs)</label>
        <label className="full"><span>Note</span><input value={f.note} maxLength={500} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Offered at orientation; signed waiver on file" /></label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row"><button className="btn" onClick={save} disabled={busy}>Save offer</button><button className="btn ghost" onClick={onDone}>Cancel</button></div>
    </section>
  );
}

function PolicyForm({ policy }: { policy: AcaPolicy & { saved: boolean } }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [p, setP] = useState(policy);
  const [error, setError] = useState('');
  const num = (k: keyof AcaPolicy) => (e: React.ChangeEvent<HTMLSelectElement>) => setP({ ...p, [k]: Number(e.target.value) });
  async function save() {
    setError('');
    try { await api('/api/aca/policy', 'PATCH', { measurementMonths: p.measurementMonths, adminMonths: p.adminMonths, stabilityMonths: p.stabilityMonths, startMonth: p.startMonth }); toast('ACA settings saved.'); router.refresh(); }
    catch (e) { setError((e as Error).message); }
  }
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  return (
    <section className="card" id="aca-settings">
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Measurement settings {!policy.saved && <span className="pill a">Defaults</span>}</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Use the same periods your benefits broker and plan documents use. Changing them changes everyone’s status, so set them once.</p>
      <div className="form payform">
        <label><span>Measurement period</span><select value={p.measurementMonths} onChange={num('measurementMonths')}>{range(3, 12).map((n) => <option key={n} value={n}>{n} months</option>)}</select></label>
        <label><span>Starts each</span><select value={p.startMonth} onChange={num('startMonth')}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m} 1</option>)}</select></label>
        <label><span>Administrative period</span><select value={p.adminMonths} onChange={num('adminMonths')}>{range(0, 2).map((n) => <option key={n} value={n}>{n ? `${n} month${n === 1 ? '' : 's'}` : 'None'}</option>)}</select></label>
        <label><span>Stability period</span><select value={p.stabilityMonths} onChange={num('stabilityMonths')}>{range(6, 12).map((n) => <option key={n} value={n}>{n} months</option>)}</select></label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn ghost" onClick={save}>Save settings</button>
    </section>
  );
}
