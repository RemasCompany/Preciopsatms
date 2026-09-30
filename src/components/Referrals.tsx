'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords } from './Records';
import type { ReferralRow } from '@/lib/referrals';

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default function Referrals({ rows, bonus, minHours, isAdmin, canEdit }: { rows: ReferralRow[]; bonus: number | null; minHours: number; isAdmin: boolean; canEdit: boolean }) {
  const router = useRouter();
  const { toast, open } = useRecords();
  const [b, setB] = useState(bonus == null ? '' : String(bonus)), [h, setH] = useState(String(minHours));
  const call = async (url: string, method: string, body: object, ok: string) => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return toast(j.error ?? 'That didn’t work.', true);
    toast(ok); router.refresh();
  };
  return (
    <>
      {isAdmin && canEdit && (
        <section className="card">
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Referral bonus</h2>
          <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label>Bonus ($, blank for none)<input type="number" min={0} step={5} value={b} onChange={(e) => setB(e.target.value)} style={{ width: 120 }} /></label>
            <label>After the friend works (hours)<input type="number" min={0} value={h} onChange={(e) => setH(e.target.value)} style={{ width: 120 }} /></label>
            <button className="btn sm" onClick={() => call('/api/referrals/settings', 'PATCH', { bonus: b ? Number(b) : null, minHours: Number(h) || 0 }, 'Saved. Applies to new referrals.')}>Save</button>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>Workers see this on their private link. Each referral keeps the bonus that applied when it was made. Pay it through payroll, then mark it paid here.</p>
        </section>
      )}
      {rows.length ? (
        <div className="tablewrap" style={{ marginTop: 16 }}><table><thead><tr><th>Referred</th><th>By</th><th>Hours worked</th><th>Bonus</th><th>Status</th>{isAdmin && canEdit && <th />}</tr></thead><tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><button className="linkbtn" onClick={() => open('candidates', r.friendId)}><b>{r.friend}</b></button><div className="muted">{new Date(r.createdAt).toLocaleDateString()}{r.friendStatus ? ` · ${r.friendStatus}` : ''}</div></td>
              <td><button className="linkbtn" onClick={() => open('candidates', r.referrerId)}>{r.referrer}</button></td>
              <td>{r.hours}{r.minHours ? ` / ${r.minHours}` : ''}</td>
              <td>{r.bonus == null ? '—' : money(r.bonus)}</td>
              <td><span className={`pill ${r.status === 'paid' ? 'g' : r.due ? 'a' : ''}`}>{r.status === 'paid' ? 'Paid' : r.status === 'ineligible' ? 'Not eligible' : r.due ? 'Bonus due' : 'Waiting'}</span>{r.ineligibleReason && <div className="muted">{r.ineligibleReason}</div>}</td>
              {isAdmin && canEdit && <td className="row">
                {r.due && <button className="btn sm" onClick={() => call(`/api/referrals/${r.id}`, 'PATCH', { action: 'paid' }, 'Marked paid.')}>Mark paid</button>}
                {r.status === 'submitted' && <button className="btn ghost sm" onClick={() => { const why = prompt('Why isn’t this referral eligible?'); if (why) call(`/api/referrals/${r.id}`, 'PATCH', { action: 'ineligible', reason: why }, 'Updated.'); }}>Not eligible</button>}
                {r.status !== 'submitted' && <button className="btn ghost sm" onClick={() => call(`/api/referrals/${r.id}`, 'PATCH', { action: 'reopen' }, 'Reopened.')}>Reopen</button>}
              </td>}
            </tr>
          ))}
        </tbody></table></div>
      ) : <div className="card empty"><b>No referrals yet</b>Workers refer friends from their private link (the one in their schedule and time clock messages).</div>}
    </>
  );
}
