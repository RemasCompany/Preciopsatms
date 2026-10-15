'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords } from './Records';

/** Staffing agency or employer, and (for agencies) employee records for their own staff. Owners only. */
export default function CompanyType({ kind, hrEnabled, owner, paid }: { kind: 'STAFFING' | 'EMPLOYER'; hrEnabled: boolean; owner: boolean; paid: boolean }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [busy, setBusy] = useState(false);
  async function save(next: { kind: 'STAFFING' | 'EMPLOYER'; hrEnabled?: boolean }) {
    if (next.kind !== kind && !confirm(next.kind === 'EMPLOYER'
      ? `Switch to employer? Client, sales, vendor and invoicing pages are hidden (nothing is deleted), and${paid ? ' your subscription moves to per-employee pricing.' : ' plans are priced per employee.'}`
      : `Switch to staffing agency? Client, sales, vendor and invoicing pages come back, and${paid ? ' your subscription moves to agency pricing.' : ' plans are priced for agencies.'}`)) return;
    setBusy(true);
    try {
      const r = await fetch('/api/org/type', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'Couldn’t save that. Try again.');
      toast('Saved.'); router.refresh();
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Company type</h2>
      <fieldset className="kindpick" disabled={!owner || busy}>
        <legend className="sr-only">Company type</legend>
        <label className="check"><input type="radio" name="orgkind" checked={kind === 'STAFFING'} onChange={() => save({ kind: 'STAFFING' })} /> <span><b>Staffing agency</b><span className="muted">You place workers with client companies: clients, sales, vendors, bill rates and client invoicing.</span></span></label>
        <label className="check"><input type="radio" name="orgkind" checked={kind === 'EMPLOYER'} onChange={() => save({ kind: 'EMPLOYER' })} /> <span><b>Employer</b><span className="muted">You hire and manage your own employees: departments, managers, an org chart and pay history. Billed per active employee.</span></span></label>
      </fieldset>
      {kind === 'STAFFING' && (
        <label className="check"><input type="checkbox" checked={hrEnabled} disabled={!owner || busy} onChange={(e) => save({ kind, hrEnabled: e.target.checked })} /> Also keep employee records for our own staff (“Our employees” page)</label>
      )}
      {!owner && <p className="muted">Only the account owner can change this.</p>}
    </section>
  );
}
