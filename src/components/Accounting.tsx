'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords } from './Records';

type Conn = { provider: 'quickbooks' | 'xero'; name: string; enabled: boolean; connected: null | { tenantName: string | null; connectedAt: string; lastSyncAt: string | null; lastError: string | null } };

/** Settings: connect QuickBooks Online or Xero, see sync health, disconnect. */
export function AccountingCard({ providers, canEdit, error, justConnected }: { providers: Conn[]; canEdit: boolean; error?: string; justConnected?: boolean }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [busy, setBusy] = useState(false);
  async function disconnect(p: Conn) {
    if (!confirm(`Disconnect ${p.name}? Invoices already sent stay there; new ones won’t be sent until you reconnect.`)) return;
    setBusy(true);
    const r = await fetch(`/api/integrations/${p.provider}/disconnect`, { method: 'POST' });
    setBusy(false);
    if (!r.ok) return toast((await r.json().catch(() => ({}))).error ?? 'Could not disconnect.', true);
    toast(`${p.name} disconnected.`); router.refresh();
  }
  return (
    <section className="card" id="accounting">
      <h2 style={{ marginTop: 0 }}>Accounting</h2>
      <p className="muted">Send invoices and client payments to your accounting system so the books match without retyping. Each worker’s regular and overtime hours become separate lines on the invoice.</p>
      {justConnected && <p className="card banner" role="status">Connected. Send invoices from the Invoices page.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="list">{providers.map((p) => (
        <div key={p.provider} className="li" style={{ flexWrap: 'wrap' }}>
          <div className="x"><b>{p.name}</b>
            <span className="muted">{p.connected
              ? <>Connected{p.connected.tenantName ? ` to ${p.connected.tenantName}` : ''} · {p.connected.lastSyncAt ? `last sent ${new Date(p.connected.lastSyncAt).toLocaleString()}` : 'nothing sent yet'}</>
              : p.enabled ? 'Not connected' : 'Not set up on this server (an administrator adds the app keys)'}</span>
            {p.connected?.lastError && <span className="warn">Last problem: {p.connected.lastError}</span>}
          </div>
          {canEdit && p.enabled && (p.connected
            ? <button className="btn ghost sm" disabled={busy} onClick={() => disconnect(p)}>Disconnect</button>
            : <a className="btn sm" href={`/api/integrations/${p.provider}/connect`}>Connect</a>)}
        </div>
      ))}</div>
    </section>
  );
}

/** Invoices page / invoice page: send to the connected accounting system. */
export function SyncButton({ provider, invoiceIds, label }: { provider: string; invoiceIds?: string[]; label?: string }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const r = await fetch('/api/integrations/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceIds }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast(j.error ?? 'Could not send.', true);
    const sent = `Sent ${j.invoices} invoice${j.invoices === 1 ? '' : 's'} and ${j.payments} payment${j.payments === 1 ? '' : 's'} to ${j.provider}.`;
    toast(j.failed.length ? `${sent} Problems: ${j.failed.join('; ')}` : sent, j.failed.length > 0);
    router.refresh();
  }
  return <button className="btn ghost" disabled={busy} onClick={go}>{busy ? 'Sending…' : label ?? `Send to ${provider}`}</button>;
}
