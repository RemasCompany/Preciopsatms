'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Drawer from './Drawer';
import { useRecords } from './Records';
import { ITEM_KINDS, PAYMENT_METHODS, invoiceTotals, itemCents, usd, type ItemKind } from '@/lib/invoicing';

const post = async (url: string, body?: object, method = 'POST') => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, j: await r.json().catch(() => ({})) };
};

type Item = { kind: ItemKind; description: string; quantity: string; rate: string };
export type Details = { poNumber: string; billToName: string; billToAddress: string; notes: string; taxRatePct: string; items: Item[] };
const money = (c: number) => usd(c);
const ITEM_SUGGESTIONS = ['Background check', 'Drug screening', 'Mileage', 'Parking', 'Per diem', 'Safety equipment (PPE)', 'Uniforms', 'Placement fee', 'Rush order fee', 'Volume discount', 'Credit for short shift'];
const itemC = (i: Item) => itemCents(i.kind, Number(i.quantity) || 0, Number(i.rate) || 0);

/** Who it's addressed to, the PO, extra items, tax and the note — shared by "New invoice" and "Edit draft". */
function DetailsEditor({ d, set, contacts, laborCents }: { d: Details; set: (d: Details) => void; contacts: { id: string; name: string; title: string | null }[]; laborCents: number }) {
  const t = invoiceTotals(laborCents, d.items.map(itemC), Number(d.taxRatePct) || 0);
  const item = (i: number, patch: Partial<Item>) => set({ ...d, items: d.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <>
      <section className="invsec"><h3>Bill to</h3>
        <div className="invgrid">
          <label><span>Attention</span><input list="attnList" value={d.billToName} maxLength={120} onChange={(e) => set({ ...d, billToName: e.target.value })} placeholder={contacts.length ? 'Pick a contact or type a name' : 'e.g. Accounts Payable'} />
            <datalist id="attnList">{contacts.map((c) => <option key={c.id} value={c.name}>{c.title ?? ''}</option>)}</datalist></label>
          <label><span>Purchase order (PO) number</span><input value={d.poNumber} maxLength={60} onChange={(e) => set({ ...d, poNumber: e.target.value })} placeholder="e.g. PO-44718" /></label>
          <label className="full" style={{ gridColumn: '1/-1' }}><span>Billing address</span><textarea rows={3} value={d.billToAddress} maxLength={400} onChange={(e) => set({ ...d, billToAddress: e.target.value })} placeholder={'Accounts Payable\n200 Harbor Blvd\nTampa, FL 33602'} /></label>
        </div>
      </section>
      <section className="invsec"><h3>Additional items <button type="button" className="btn ghost sm" onClick={() => set({ ...d, items: [...d.items, { kind: 'expense', description: '', quantity: '1', rate: '' }] })} disabled={d.items.length >= 50}>+ Add item</button></h3>
        {d.items.length === 0 ? <p className="muted" style={{ margin: 0 }}>Add reimbursed expenses (background checks, mileage, PPE), fees, or a discount or credit.</p> : (
          <div className="items">
            <datalist id="itemSuggest">{ITEM_SUGGESTIONS.map((x) => <option key={x} value={x} />)}</datalist>
            {d.items.map((it, i) => { const c = itemC(it); return (
              <div key={i} className="itemrow">
                <select aria-label="Kind" value={it.kind} onChange={(e) => item(i, { kind: e.target.value as ItemKind })}>{Object.entries(ITEM_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <input className="desc" aria-label="Description" list="itemSuggest" value={it.description} maxLength={200} placeholder="Description" onChange={(e) => item(i, { description: e.target.value })} />
                <input aria-label="Quantity" type="number" min={0.01} step="any" value={it.quantity} onChange={(e) => item(i, { quantity: e.target.value })} />
                <input aria-label="Amount each" type="number" min={0} step="0.01" value={it.rate} placeholder="$ each" onChange={(e) => item(i, { rate: e.target.value })} />
                <span className={`amt${c < 0 ? ' neg' : ''}`}>{money(c)}</span>
                <button type="button" className="btn ghost sm" aria-label="Remove item" onClick={() => set({ ...d, items: d.items.filter((_, j) => j !== i) })}>✕</button>
              </div>); })}
          </div>
        )}
      </section>
      <section className="invsec"><div className="invgrid">
        <label><span>Sales tax (%)</span><input type="number" min={0} max={25} step="0.001" value={d.taxRatePct} onChange={(e) => set({ ...d, taxRatePct: e.target.value })} /></label>
        <span className="muted" style={{ alignSelf: 'end', fontSize: 13, paddingBottom: 12 }}>Most states don’t tax staffing services; some (like NM, HI, SD, WV, CT, NY for some services) do. Leave at 0 unless you collect it.</span>
        <label style={{ gridColumn: '1/-1' }}><span>Note to the client (printed on the invoice)</span><textarea rows={2} value={d.notes} maxLength={1000} onChange={(e) => set({ ...d, notes: e.target.value })} placeholder="e.g. Thank you for partnering with us on the peak-season ramp." /></label>
      </div></section>
      <section className="invsec"><div className="invtotals">
        <span>Services (hours)</span><span>{money(t.labor)}</span>
        {t.extras > 0 && <><span>Additional items</span><span>{money(t.extras)}</span></>}
        {t.discounts > 0 && <><span>Discounts and credits</span><span>-{money(t.discounts)}</span></>}
        <span>Subtotal</span><span>{money(t.subtotal)}</span>
        {t.tax > 0 && <><span>Sales tax ({Number(d.taxRatePct)}%)</span><span>{money(t.tax)}</span></>}
        <span className="big">Total</span><span className="big">{money(t.total)}</span>
      </div>{t.subtotal < 0 && <p className="error">Discounts are more than the invoice.</p>}</section>
    </>
  );
}

const toBody = (d: Details) => ({
  poNumber: d.poNumber.trim(), billToName: d.billToName.trim(), billToAddress: d.billToAddress.trim(), notes: d.notes.trim(), taxRatePct: Number(d.taxRatePct) || 0,
  items: d.items.filter((i) => i.description.trim() || Number(i.rate)).map((i) => ({ kind: i.kind, description: i.description.trim(), quantity: Number(i.quantity), rate: Number(i.rate) })),
});

type Preview = { client: { id: string; name: string; terms: string; due: string }; defaults: { poNumber: string; billToName: string; billToAddress: string; taxRatePct: number }; contacts: { id: string; name: string; title: string | null }[];
  lines: { timesheetId: string; worker: string; description: string; weekEnding: string; regularHours: number; overtimeHours: number; rate: number; amount: number; cents: number; approvedBy: string | null }[] };

/** "New invoice": pick a client and period, check the hours, add the billing details and any extra items, then create a draft to review before sending. */
export function NewInvoice({ clients, defaultFrom, defaultTo }: { clients: { id: string; name: string; unbilled: number }[]; defaultFrom: string; defaultTo: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState(clients.find((c) => c.unbilled)?.id ?? clients[0]?.id ?? '');
  const [from, setFrom] = useState(defaultFrom), [to, setTo] = useState(defaultTo);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [skip, setSkip] = useState<string[]>([]);
  const [d, setD] = useState<Details>({ poNumber: '', billToName: '', billToAddress: '', notes: '', taxRatePct: '0', items: [] });
  const [save, setSave] = useState(false);
  const lastClient = useRef('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');

  useEffect(() => {
    if (!open || !clientId || !from || !to) return;
    let live = true; setLoading(true); setError('');
    fetch(`/api/invoices/preview?${new URLSearchParams({ clientId, from, to })}`).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!live) return;
      setLoading(false);
      if (!r.ok) { setPreview(null); return setError(j.error ?? 'Could not load the hours.'); }
      const p = j as Preview;
      // A different client starts from that client's billing defaults; new dates for the same client keep what was typed.
      if (lastClient.current !== p.client.id) setD((x) => ({ ...x, poNumber: p.defaults.poNumber, billToName: p.defaults.billToName, billToAddress: p.defaults.billToAddress, taxRatePct: String(p.defaults.taxRatePct) }));
      lastClient.current = p.client.id;
      setPreview(p); setSkip([]);
    });
    return () => { live = false; };
  }, [open, clientId, from, to]);

  const lines = preview?.lines ?? [];
  const included = lines.filter((l) => !skip.includes(l.timesheetId));
  const labor = included.reduce((s, l) => s + l.cents, 0);
  async function create() {
    setBusy(true); setError('');
    const { ok, j } = await post('/api/invoices', { clientId, from, to, excludeTimesheetIds: skip, saveDefaults: save, ...toBody(d) });
    setBusy(false);
    if (!ok) return setError(j.error ?? 'Could not create the invoice.');
    router.push(`/app/invoices/${j.id}`);
  }
  const workers = new Set(included.map((l) => l.worker)).size;
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)} disabled={!clients.length}>+ New invoice</button>
      {open && (
        <Drawer wide title="New invoice" kicker="From approved hours" onClose={() => setOpen(false)}
          footer={<><button className="btn" onClick={create} disabled={busy || !clientId || !included.length || loading}>{busy ? 'Creating…' : 'Create draft'}</button><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
            <span className="muted" style={{ fontSize: 13 }}>You can review the PDF and change details before emailing it.</span></>}>
          <div className="invgrid">
            <label style={{ gridColumn: '1/-1' }}><span>Client</span><select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.unbilled ? ` — ${c.unbilled} week${c.unbilled === 1 ? '' : 's'} of approved hours not invoiced` : ''}</option>)}
            </select></label>
            <label><span>Weeks ending from</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label><span>to</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          {preview && <p className="muted" style={{ margin: '4px 0 0' }}>{preview.client.terms} · due {new Date(`${preview.client.due}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} if created today</p>}
          <section className="invsec"><h3>Hours <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>{loading ? 'Loading…' : lines.length ? `${included.length} of ${lines.length} timesheets · ${workers} worker${workers === 1 ? '' : 's'} · ${money(labor)}` : ''}</span></h3>
            {!loading && !lines.length ? <p className="muted">No approved hours for this client in that period that aren’t already invoiced. Approve timesheets first, or widen the dates.</p> : (
              <div className="invhours"><table><thead><tr><th><span className="sr-only">Include</span></th><th>Worker</th><th>Position</th><th>Week ending</th><th className="num">Reg</th><th className="num">OT</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
                <tbody>{lines.map((l) => { const off = skip.includes(l.timesheetId); return (
                  <tr key={l.timesheetId} className={off ? 'off' : ''}>
                    <td><input type="checkbox" checked={!off} aria-label={`Include ${l.worker}, week ending ${l.weekEnding}`} onChange={(e) => setSkip((x) => (e.target.checked ? x.filter((y) => y !== l.timesheetId) : [...x, l.timesheetId]))} /></td>
                    <td>{l.worker}{l.approvedBy && <div className="ok">✓ {l.approvedBy}</div>}</td><td>{l.description}</td><td>{new Date(`${l.weekEnding}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td className="num">{l.regularHours}</td><td className="num">{l.overtimeHours || '—'}</td><td className="num">{money(Math.round(l.rate * 100))}</td><td className="num">{money(l.cents)}</td>
                  </tr>); })}</tbody></table></div>
            )}
            {skip.length > 0 && <p className="muted" style={{ fontSize: 13 }}>Unchecked weeks stay unbilled for a later invoice.</p>}
          </section>
          {preview && <DetailsEditor d={d} set={setD} contacts={preview.contacts} laborCents={labor} />}
          {preview && <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Use this attention, address, PO and tax rate for {preview.client.name}’s future invoices</label>}
          {error && <p className="error" role="alert">{error}</p>}
        </Drawer>
      )}
    </>
  );
}

/** Edit a draft's details and additional items before it goes to the client. */
export function EditDraft({ id, number, initial, contacts, laborCents }: { id: string; number: string; initial: Details; contacts: { id: string; name: string; title: string | null }[]; laborCents: number }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [open, setOpen] = useState(false);
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    const { ok, j } = await post(`/api/invoices/${id}`, { action: 'details', ...toBody(d) }, 'PATCH');
    setBusy(false);
    if (!ok) return setError(j.error ?? 'Could not save the invoice.');
    toast(`${number} updated.`); setOpen(false); router.refresh();
  }
  return (
    <>
      <button className="btn ghost" onClick={() => { setD(initial); setOpen(true); }}>Edit details</button>
      {open && (
        <Drawer wide title={`Edit ${number}`} kicker="Draft — not sent yet" onClose={() => setOpen(false)}
          footer={<><button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button></>}>
          <p className="muted" style={{ marginTop: 0 }}>The hours stay as they are. To change hours, void this draft, fix the timesheets and make a new invoice.</p>
          <DetailsEditor d={d} set={setD} contacts={contacts} laborCents={laborCents} />
          {error && <p className="error" role="alert">{error}</p>}
        </Drawer>
      )}
    </>
  );
}

type Contact = { id: string; name: string; email: string | null };
type Pay = { id: string; amount: number; receivedOn: string; method: string; reference: string | null };

/** Send, record payments, remove a payment and void — on the invoice page. */
export function InvoiceActions({ id, number, status, balance, contacts, payments, sentTo, billingEmail }: { id: string; number: string; status: string; balance: number; contacts: Contact[]; payments: Pay[]; sentTo: string | null; billingEmail?: string | null }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [mode, setMode] = useState<'send' | 'pay' | 'void' | null>(null);
  const [picked, setPicked] = useState<string[]>(billingEmail ? [] : contacts.filter((c) => c.email).slice(0, 1).map((c) => c.id));
  const [ap, setAp] = useState(!!billingEmail);
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
        <a className="btn ghost" href={`/api/invoices/${id}/pdf?view`} target="_blank" rel="noopener">View PDF</a>
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
          footer={<><button className="btn" disabled={busy || (!picked.length && !ap)} onClick={() => run(`/api/invoices/${id}/send`, { contactIds: picked, billingEmail: ap, message: message || undefined }, (j) => `Sent to ${(j.sent as string[]).join(', ')}.${(j.failed as string[]).length ? ` Couldn’t reach ${(j.failed as string[]).join(', ')}.` : ''}`)}>{busy ? 'Sending…' : 'Send'}</button><button className="btn ghost" onClick={close}>Cancel</button></>}>
          {billingEmail && <label className="check"><input type="checkbox" checked={ap} onChange={(e) => setAp(e.target.checked)} /> Accounts payable <span className="muted">{billingEmail}</span></label>}
          {contacts.length ? contacts.map((c) => (
            <label key={c.id} className="check"><input type="checkbox" disabled={!c.email} checked={picked.includes(c.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} /> {c.name} <span className="muted">{c.email ?? 'no email'}</span></label>
          )) : !billingEmail && <p className="warn">This client has no contacts or accounts payable email. Add one on the client record first.</p>}
          {status === 'DRAFT' && !sentTo && <p className="muted">Once it’s emailed, the invoice is final — its details can’t be changed.</p>}
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
