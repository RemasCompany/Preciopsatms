'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Drawer from './Drawer';
import { useRecords } from './Records';
import { PAYMENT_METHODS } from '@/lib/invoicing';

const post = async (url: string, body?: object, method = 'POST') => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, j: await r.json().catch(() => ({})) };
};

/** "New invoice": pick a client and a period; it bills every approved hour not yet invoiced. */
export function NewInvoice({ clients, defaultFrom, defaultTo }: { clients: { id: string; name: string; unbilled: number }[]; defaultFrom: string; defaultTo: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState(clients.find((c) => c.unbilled)?.id ?? clients[0]?.id ?? '');
  const [from, setFrom] = useState(defaultFrom), [to, setTo] = useState(defaultTo);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function create() {
    setBusy(true); setError('');
    const { ok, j } = await post('/api/invoices', { clientId, from, to, notes: notes || undefined });
    setBusy(false);
    if (!ok) return setError(j.error ?? 'Could not create the invoice.');
    router.push(`/app/invoices/${j.id}`);
  }
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)} disabled={!clients.length}>+ New invoice</button>
      {open && (
        <Drawer title="New invoice" kicker="From approved hours" onClose={() => setOpen(false)}
          footer={<><button className="btn" onClick={create} disabled={busy || !clientId}>{busy ? 'Creating…' : 'Create invoice'}</button><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button></>}>
          <label><span>Client</span><select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.unbilled ? ` — ${c.unbilled} week${c.unbilled === 1 ? '' : 's'} of approved hours not invoiced` : ''}</option>)}
          </select></label>
          <div className="row"><label><span>Weeks ending from</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label><span>to</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></div>
          <label><span>Note on the invoice (optional)</span><textarea rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. PO 4471" /></label>
          <p className="muted">Includes every approved or paid timesheet for this client in the period that isn’t on another invoice. Bill rates are the ones saved with each timesheet; overtime bills at 1.5x. The due date follows the client’s payment terms.</p>
          {error && <p className="error" role="alert">{error}</p>}
        </Drawer>
      )}
    </>
  );
}

type Contact = { id: string; name: string; email: string | null };
type Pay = { id: string; amount: number; receivedOn: string; method: string; reference: string | null };

/** Send, record payments, remove a payment and void — on the invoice page. */
export function InvoiceActions({ id, number, status, balance, contacts, payments, sentTo }: { id: string; number: string; status: string; balance: number; contacts: Contact[]; payments: Pay[]; sentTo: string | null }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [mode, setMode] = useState<'send' | 'pay' | 'void' | null>(null);
  const [picked, setPicked] = useState<string[]>(contacts.filter((c) => c.email).slice(0, 1).map((c) => c.id));
  const [message, setMessage] = useState('');
  const [amount, setAmount] = useState(balance.toFixed(2));
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<keyof typeof PAYMENT_METHODS>('ach');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const close = () => { setMode(null); setError(''); };
  const live = status !== 'VOID';

  async function run(url: string, body: object | undefined, done: (j: Record<string, unknown>) => string, method = 'POST') {
    setBusy(true); setError('');
    const { ok, j } = await post(url, body, method);
    setBusy(false);
    if (!ok) return setError(j.error ?? 'That didn’t work. Try again.');
    toast(done(j)); close(); router.refresh();
  }

  return (
    <>
      <div className="row">
        <a className="btn ghost" href={`/api/invoices/${id}/pdf`}>Download PDF</a>
        {live && <button className="btn" onClick={() => setMode('send')}>{sentTo ? 'Email again' : 'Email to client'}</button>}
        {live && balance > 0 && <button className="btn" onClick={() => { setAmount(balance.toFixed(2)); setMode('pay'); }}>Record payment</button>}
        {live && !payments.length && <button className="btn ghost danger" onClick={() => setMode('void')}>Void</button>}
      </div>
      {!!payments.length && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Payments</h2>
          <div className="list">{payments.map((p) => (
            <div key={p.id} className="li"><div className="x"><b>{p.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</b><span className="muted">{p.receivedOn} · {PAYMENT_METHODS[p.method as keyof typeof PAYMENT_METHODS] ?? p.method}{p.reference ? ` · ref ${p.reference}` : ''}</span></div>
              <button className="btn ghost sm" disabled={busy} onClick={() => { if (confirm('Remove this payment? The invoice balance goes back up.')) run(`/api/invoices/${id}/payments/${p.id}`, undefined, () => 'Payment removed.', 'DELETE'); }}>Remove</button></div>
          ))}</div>
        </section>
      )}
      {mode === 'send' && (
        <Drawer title={`Email ${number}`} kicker="Sends the PDF" onClose={close}
          footer={<><button className="btn" disabled={busy || !picked.length} onClick={() => run(`/api/invoices/${id}/send`, { contactIds: picked, message: message || undefined }, (j) => `Sent to ${(j.sent as string[]).join(', ')}.${(j.failed as string[]).length ? ` Couldn’t reach ${(j.failed as string[]).join(', ')}.` : ''}`)}>{busy ? 'Sending…' : 'Send'}</button><button className="btn ghost" onClick={close}>Cancel</button></>}>
          {contacts.length ? contacts.map((c) => (
            <label key={c.id} className="check"><input type="checkbox" disabled={!c.email} checked={picked.includes(c.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} /> {c.name} <span className="muted">{c.email ?? 'no email'}</span></label>
          )) : <p className="warn">This client has no contacts. Add one with an email address on the client record first.</p>}
          <label><span>Message (optional)</span><textarea rows={3} value={message} maxLength={2000} onChange={(e) => setMessage(e.target.value)} /></label>
          <p className="muted">Each person gets their own email with the PDF attached, sent from your company name with replies coming to you.</p>
          {error && <p className="error" role="alert">{error}</p>}
        </Drawer>
      )}
      {mode === 'pay' && (
        <Drawer title="Record payment" kicker={number} onClose={close}
          footer={<><button className="btn" disabled={busy} onClick={() => run(`/api/invoices/${id}/payments`, { amount: Number(amount), receivedOn, method, reference: reference || undefined }, () => 'Payment recorded.')}>{busy ? 'Saving…' : 'Save payment'}</button><button className="btn ghost" onClick={close}>Cancel</button></>}>
          <div className="row"><label><span>Amount ($)</span><input type="number" min={0.01} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} /></label><label><span>Received</span><input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} /></label></div>
          <label><span>Method</span><select value={method} onChange={(e) => setMethod(e.target.value as keyof typeof PAYMENT_METHODS)}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label><span>Check number or reference (optional)</span><input value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} /></label>
          <p className="muted">Balance before this payment: {balance.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}. Partial payments are fine.</p>
          {error && <p className="error" role="alert">{error}</p>}
        </Drawer>
      )}
      {mode === 'void' && (
        <Drawer title={`Void ${number}?`} onClose={close}
          footer={<><button className="btn danger" disabled={busy} onClick={() => run(`/api/invoices/${id}`, { action: 'void', reason }, () => `${number} voided. Its hours can go on a new invoice.`, 'PATCH')}>Void invoice</button><button className="btn ghost" onClick={close}>Keep it</button></>}>
          <p>The invoice stays on file marked void, and its hours can be billed again on a new invoice.</p>
          <label><span>Reason</span><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong bill rate" /></label>
          {error && <p className="error" role="alert">{error}</p>}
        </Drawer>
      )}
    </>
  );
}
