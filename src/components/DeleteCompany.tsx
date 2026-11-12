'use client';
import { useState } from 'react';
import { signOut } from 'next-auth/react';

/** Owner-only: delete the company and everything in it, after typing its name and re-entering the password. */
export default function DeleteCompany({ company, twoStep, subscribed }: { company: string; twoStep: boolean; subscribed: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await fetch('/api/org/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmName: name, password, ...(twoStep ? { code } : {}) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(false); setErr(j.error ?? 'Something went wrong. Nothing was deleted.'); return; }
    await signOut({ callbackUrl: '/?deleted=1' });
  }
  return (
    <section className="card danger" id="delete-company">
      <h2 style={{ marginTop: 0 }}>Delete company</h2>
      <p className="muted" style={{ marginTop: 0 }}>Permanently deletes <b>{company}</b> and everything in it: candidates, employees, jobs, clients, timesheets, payroll runs, invoices, documents and uploaded files, the audit log, and your team’s access. Teammates who don’t belong to another company lose their login. This can’t be undone.</p>
      {!open ? <button className="btn danger" onClick={() => setOpen(true)}>Delete company…</button> : (
        <form onSubmit={submit}>
          <ol className="steps">
            <li><b>Download your data first.</b> <a href="/api/account/export">Download everything</a>. You may need to keep some records for years (I-9s, payroll and tax records, applicant records), and you’re responsible for keeping them.</li>
            {subscribed && <li>Your subscription is canceled straight away, with no further charges. Past invoices stay in Stripe.</li>}
            <li>Records kept by connected services stay there: payroll history in Check, background reports in Checkr, and invoices in QuickBooks or Xero. The connections themselves are removed.</li>
          </ol>
          <label><span>Type <b>{company}</b> to confirm</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required /></label>
          <label>Your password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
          {twoStep && <label>Code from your authenticator app (or a recovery code)<input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required maxLength={20} /></label>}
          {err && <p className="error" role="alert">{err}</p>}
          <div className="row">
            <button className="btn destroy" disabled={busy || name.trim().toLowerCase() !== company.trim().toLowerCase()}>{busy ? 'Deleting…' : 'Delete company permanently'}</button>
            <button type="button" className="btn ghost" onClick={() => { setOpen(false); setErr(''); }}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
