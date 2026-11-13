'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords } from './Records';

type Props = {
  available: boolean; // Stripe keys are set on this server
  connected: boolean; ready: boolean;
  initial: { onlinePayments: boolean; cardFeePct: number; invoiceReminders: boolean };
  canEdit: boolean; notice?: string; error?: string;
};

/** Settings: let clients pay invoices online through the firm's own Stripe account, and remind them automatically. */
export default function OnlinePayments({ available, connected, ready, initial, canEdit, notice, error }: Props) {
  const router = useRouter();
  const { toast } = useRecords();
  const [v, setV] = useState({ ...initial, cardFeePct: String(initial.cardFeePct) });
  const [busy, setBusy] = useState(false);
  async function save(patch: Partial<{ onlinePayments: boolean; cardFeePct: number; invoiceReminders: boolean }>) {
    setBusy(true);
    const r = await fetch('/api/payments/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { toast(j.error ?? 'Could not save.', true); setV({ ...initial, cardFeePct: String(initial.cardFeePct) }); return; }
    toast('Saved.'); router.refresh();
  }
  async function post(url: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    const r = await fetch(url, { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast(j.error ?? 'Something went wrong.', true);
    if (url.endsWith('/return')) toast(j.ready ? 'Stripe is ready to take payments.' : 'Stripe is still reviewing your account. Check again later.', !j.ready);
    router.refresh();
  }
  const fee = Number(v.cardFeePct);
  return (
    <section className="card" id="payments">
      <h2 style={{ marginTop: 0 }}>Client payments and reminders</h2>
      <p className="muted">Clients pay invoices online from a Pay online link in the invoice email, on the PDF and in the client portal. Payments go straight into your own Stripe account (Preciops never holds the money and takes no cut), and they’re recorded on the invoice automatically.</p>
      {notice && <p className="card banner" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="list">
        <div className="li" style={{ flexWrap: 'wrap' }}>
          <div className="x"><b>Stripe</b>
            <span className="muted">{!available ? 'Not set up on this server (an administrator adds the Stripe keys)'
              : !connected ? 'Not connected' : ready ? 'Connected and ready to take payments' : 'Connected — Stripe needs a few more details before you can take payments'}</span>
          </div>
          {canEdit && available && (
            <div className="row">
              {(!connected || !ready) && <a className="btn sm" href="/api/payments/connect">{connected ? 'Finish Stripe setup' : 'Connect Stripe'}</a>}
              {connected && !ready && <button className="btn ghost sm" disabled={busy} onClick={() => post('/api/payments/connect/return')}>Check status</button>}
              {connected && <button className="btn ghost sm" disabled={busy} onClick={() => post('/api/payments/disconnect', 'Disconnect Stripe? Invoices stop offering online payment. Your Stripe account and its money stay yours.')}>Disconnect</button>}
            </div>
          )}
        </div>
      </div>
      <label className="check" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={v.onlinePayments} disabled={!canEdit || busy || !ready}
          onChange={(e) => { setV({ ...v, onlinePayments: e.target.checked }); save({ onlinePayments: e.target.checked }); }} />
        Let clients pay invoices online (bank transfer and card)
      </label>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label style={{ maxWidth: 220 }}><span>Card fee added for the client (%)</span>
          <input type="number" min={0} max={3} step={0.1} value={v.cardFeePct} disabled={!canEdit || busy} onChange={(e) => setV({ ...v, cardFeePct: e.target.value })} />
        </label>
        {canEdit && Number(v.cardFeePct) !== initial.cardFeePct && <button className="btn sm" disabled={busy} onClick={() => save({ cardFeePct: Number(v.cardFeePct) })}>Save fee</button>}
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Bank transfers never carry a fee. {fee > 0 ? `Card payers see the ${fee}% fee before they pay.` : 'Set 0 to absorb card fees yourself.'} Stripe charges you about 0.8% (up to $5) per bank transfer and 2.9% + 30¢ per card.
        {' '}Card fees (surcharges) are capped at 3%, aren’t allowed on debit cards, and are restricted in some states (for example Connecticut and Massachusetts) — check with your card processor or counsel before charging one.
      </p>
      <label className="check">
        <input type="checkbox" checked={v.invoiceReminders} disabled={!canEdit || busy}
          onChange={(e) => { setV({ ...v, invoiceReminders: e.target.checked }); save({ invoiceReminders: e.target.checked }); }} />
        Email payment reminders automatically
      </label>
      <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Sent to whoever the invoice was emailed to: 3 days before it’s due, on the due date, then 7, 14, 30, 60 and 90 days past due, until it’s paid. Each reminder has the PDF{ready && v.onlinePayments ? ' and the Pay online link' : ''}. Contacts who unsubscribed are skipped.</p>
    </section>
  );
}
