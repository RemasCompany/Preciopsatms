'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { OpenRecord } from './Records';

export type ExclusionRow = {
  id: string; candidateId: string; worker: string; listedName: string; listedPlace: string | null; listedNpi: string | null; dob: string | null; excluded: string | null;
  exclType: string | null; specialty: string | null; matchedOn: 'npi' | 'name'; status: 'OPEN' | 'CLEARED' | 'CONFIRMED'; note: string | null; reviewedAt: string | null; reviewedBy: string | null;
};
const fmt = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? 'Something went wrong. Try again.');
  return j;
}

/** Monthly OIG screening: the on/off switch, a "screen now" button and the possible matches to review. */
export default function Exclusions({ enabled, lastRun, listDate, screened, rows, canEdit }: { enabled: boolean; lastRun: string | null; listDate: string | null; screened: number; rows: ExclusionRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [review, setReview] = useState<{ id: string; decision: 'CLEARED' | 'CONFIRMED'; note: string } | null>(null);
  const open = rows.filter((r) => r.status === 'OPEN'), done = rows.filter((r) => r.status !== 'OPEN');

  async function act(fn: () => Promise<string>) {
    setBusy(true); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); router.refresh(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="kpis" style={{ margin: '0 0 16px' }}>
        <div className="kpi"><b>{enabled ? 'On' : 'Off'}</b><span>Monthly screening</span>{lastRun && <span className="sub">Last run {fmt(lastRun)}{listDate ? ` · list of ${fmt(`${listDate}T12:00:00Z`)}` : ''}</span>}</div>
        <div className="kpi"><b>{screened}</b><span>Workers screened and current</span></div>
        <div className="kpi"><b className={open.length ? 'warnnum' : undefined}>{open.length}</b><span>Possible matches to review</span></div>
      </div>
      {canEdit && (
        <div className="row" style={{ marginBottom: 12 }}>
          <button className={`btn sm ${enabled ? 'ghost' : ''}`} disabled={busy} onClick={() => act(async () => { await send('/api/credentials/exclusions', 'PATCH', { enabled: !enabled }); return enabled ? 'Monthly screening is off.' : 'Monthly screening is on. The first run happens tonight, or screen everyone now.'; })}>{enabled ? 'Turn off monthly screening' : 'Turn on monthly screening'}</button>
          <button className="btn ghost sm" disabled={busy} onClick={() => act(async () => {
            const r = await send('/api/credentials/exclusions/run', 'POST');
            return `Checked ${r.workers} worker${r.workers === 1 ? '' : 's'}: ${r.newMatches ? `${r.newMatches} new possible match${r.newMatches === 1 ? '' : 'es'} to review` : 'no new matches'}.`;
          })}>{busy ? 'Working…' : 'Screen everyone now'}</button>
        </div>
      )}
      {msg && <p className={msg.ok ? 'ok' : 'error'} role="status">{msg.text}</p>}

      <h2 style={{ fontSize: 18 }}>To review</h2>
      {open.length ? <div className="list">{open.map((r) => (
        <div key={r.id} className="li card" style={{ display: 'block' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 0 }}>
            <span><OpenRecord kind="candidates" id={r.candidateId}><b>{r.worker}</b></OpenRecord> <span className={`pill ${r.matchedOn === 'npi' ? 'r' : 'a'}`}>{r.matchedOn === 'npi' ? 'Same NPI' : 'Same name'}</span>
              <div className="muted">Listed: {r.listedName}{r.listedPlace ? ` · ${r.listedPlace}` : ''}{r.dob ? ` · born ${r.dob}` : ''}{r.specialty ? ` · ${r.specialty}` : ''}{r.listedNpi ? ` · NPI ${r.listedNpi}` : ''}</div>
              <div className="muted">Excluded{r.excluded ? ` ${r.excluded}` : ''}{r.exclType ? ` under ${r.exclType}` : ''}</div>
            </span>
            {canEdit && review?.id !== r.id && <span className="row" style={{ marginTop: 0 }}>
              <button className="btn ghost sm" onClick={() => setReview({ id: r.id, decision: 'CLEARED', note: '' })}>Not them</button>
              <button className="btn danger sm" onClick={() => setReview({ id: r.id, decision: 'CONFIRMED', note: '' })}>Confirmed</button>
            </span>}
          </div>
          {review?.id === r.id && (
            <div className="subform">
              <p className="muted" style={{ marginTop: 0 }}>{review.decision === 'CONFIRMED'
                ? `${r.worker} will go on the company-wide do-not-return list, which stops placing and scheduling them. Tell their manager and your compliance contact.`
                : 'Their screening will be renewed. This name won’t be raised again for them.'}</p>
              <label>How did you check?<input value={review.note} maxLength={500} onChange={(e) => setReview({ ...review, note: e.target.value })} placeholder={review.decision === 'CONFIRMED' ? 'e.g. OIG search: SSN matches' : 'e.g. OIG search: SSN doesn’t match; different date of birth'} /></label>
              <div className="row"><button className={`btn sm ${review.decision === 'CONFIRMED' ? 'danger' : ''}`} disabled={busy} onClick={() => act(async () => { await send(`/api/credentials/exclusions/${r.id}`, 'PATCH', { decision: review.decision, note: review.note }); setReview(null); return review.decision === 'CONFIRMED' ? `${r.worker} is now on the do-not-return list.` : `Cleared. ${r.worker}’s screening is renewed.`; })}>{review.decision === 'CONFIRMED' ? 'Confirm exclusion' : 'Mark cleared'}</button><button className="btn ghost sm" onClick={() => setReview(null)}>Cancel</button></div>
            </div>
          )}
        </div>
      ))}</div> : <div className="card empty"><b>Nothing to review</b>{enabled ? 'Possible matches from the monthly screening show up here.' : 'Turn on monthly screening to check your workers against the OIG list.'}</div>}

      {done.length > 0 && <>
        <h2 style={{ fontSize: 18, marginTop: 24 }}>Reviewed</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Worker</th><th>Listed</th><th>Decision</th><th>Note</th></tr></thead>
          <tbody>{done.map((r) => (
            <tr key={r.id}>
              <td><OpenRecord kind="candidates" id={r.candidateId}><b>{r.worker}</b></OpenRecord></td>
              <td>{r.listedName}<div className="muted">{r.listedPlace}</div></td>
              <td><span className={`pill ${r.status === 'CONFIRMED' ? 'r' : 'g'}`}>{r.status === 'CONFIRMED' ? 'Confirmed' : 'Cleared'}</span><div className="muted">{r.reviewedAt ? fmt(r.reviewedAt) : ''}{r.reviewedBy ? ` · ${r.reviewedBy}` : ''}</div></td>
              <td>{r.note}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </>}
    </>
  );
}
