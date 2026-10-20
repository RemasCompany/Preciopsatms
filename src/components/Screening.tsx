'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Status = { state: 'off' | 'not_connected' | 'pending' | 'ready'; accountName?: string | null; connectedAt?: string };

/** Settings card: the company's own Checkr account for background checks. */
export default function ScreeningCard({ status, canEdit, notice, error }: { status: Status; canEdit: boolean; notice?: string; error?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(error ? { text: error, bad: true } : notice ? { text: notice } : null);
  async function post(path: string, done: (j: { ready?: boolean }) => string) {
    setBusy(true); setMsg(null);
    const r = await fetch(path, { method: 'POST' }); const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg({ text: j.error ?? 'Something went wrong.', bad: true });
    setMsg({ text: done(j) }); router.refresh();
  }
  const since = status.connectedAt ? new Date(status.connectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  return (
    <section className="card" id="screening">
      <h2 style={{ marginTop: 0 }}>Background checks</h2>
      <p className="muted" style={{ marginTop: 0 }}>Order Checkr background checks from any candidate’s record. Your company uses its own Checkr account: Checkr approves each employer to run checks, bills you directly, and keeps the reports.</p>
      {status.state === 'off' ? (
        <p className="muted">Background checks aren’t available on this server yet. The Preciops administrator needs Checkr partner keys (CHECKR_CLIENT_ID and CHECKR_CLIENT_SECRET).</p>
      ) : status.state === 'not_connected' ? (
        <>
          <p>Not connected.</p>
          {canEdit ? <div className="row">
            <a className="btn" href="/api/screening/checkr/connect?mode=signin">Connect your Checkr account</a>
            <a className="btn ghost" href="/api/screening/checkr/connect?mode=signup">Create a Checkr account</a>
          </div> : <p className="muted">An owner or admin can connect it.</p>}
          <p className="muted">New to Checkr? Creating an account takes a few minutes. Checkr then asks for two short forms (an account authorization and an employment certification) and approves most companies within one business day.</p>
        </>
      ) : (
        <>
          <p><span className={`pill ${status.state === 'ready' ? 'g' : 'a'}`}>{status.state === 'ready' ? 'Ready' : 'Waiting for Checkr'}</span> {status.accountName ? <b>{status.accountName}</b> : 'Checkr account'} · connected {since}</p>
          {status.state === 'pending' && <p className="muted">Checkr is reviewing your company before you can order checks. Look for an email from Checkr with two forms to complete. This page updates on its own when Checkr approves the account.</p>}
          {canEdit && <div className="row">
            {status.state === 'pending' && <button className="btn ghost" disabled={busy} onClick={() => post('/api/screening/checkr/refresh', (j) => j.ready ? 'Approved. You can order background checks now.' : 'Not approved yet. Checkr emails you when it is.')}>Check again</button>}
            <button className="btn ghost" disabled={busy} onClick={() => confirm('Disconnect your Checkr account? Checks already ordered keep their history here, and the reports stay in your Checkr account.') && post('/api/screening/checkr/disconnect', () => 'Disconnected.')}>Disconnect</button>
          </div>}
        </>
      )}
      {msg && <p className={msg.bad ? 'error' : 'okc'} role={msg.bad ? 'alert' : 'status'}>{msg.text}</p>}
    </section>
  );
}
