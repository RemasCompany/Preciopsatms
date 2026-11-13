import type { Metadata } from 'next';
import { acceptsOnline, invoiceForToken, payOptions } from '@/lib/online-payments';
import { balanceCents } from '@/lib/invoicing-server';
import { toCents, usd } from '@/lib/invoicing';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pay invoice', robots: { index: false, follow: false } };
const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Public: a client pays one invoice online, by bank transfer (no fee) or card (with the firm's card fee, if any). */
export default async function PayPage({ params, searchParams }: { params: { token: string }; searchParams: { paid?: string; error?: string } }) {
  const found = await invoiceForToken(params.token);
  if (!found) return <main className="public"><h1>Payment link not found</h1><p>This link isn’t valid. Use the link in your most recent invoice email, or reply to that email for help.</p></main>;
  const { org, inv } = found;
  const company = org.shortName ?? org.name, balance = balanceCents(inv), opts = payOptions(org, balance), feePct = Number(org.cardFeePct);
  const style = { ['--accent' as string]: org.brandColor };
  const head = (
    <>
      <p className="muted">{company}{org.billingEmail ? ` · ${org.billingEmail}` : ''}{org.billingPhone ? ` · ${org.billingPhone}` : ''}</p>
      <h1>Invoice {inv.number}</h1>
      <p className="lede">For {inv.client.name}{inv.poNumber ? ` · PO ${inv.poNumber}` : ''} · due {fmt(inv.dueDate)}</p>
      <div className="kpis" style={{ margin: '12px 0' }}>
        <div className="kpi"><b>{usd(toCents(inv.total))}</b><span>Invoice total</span></div>
        <div className="kpi"><b>{inv.status === 'VOID' ? '—' : usd(Math.max(0, balance))}</b><span>Balance due</span></div>
      </div>
      <p><a className="btn ghost sm" href={`/api/pay/${params.token}/pdf`}>Download the invoice (PDF)</a></p>
    </>
  );
  if (inv.status === 'VOID') return <main className="public" style={style}>{head}<p className="card">This invoice was voided, so there’s nothing to pay. Contact {company} with any questions.</p></main>;
  if (searchParams.paid) return (
    <main className="public" style={style}>{head}
      <div className="card banner" role="status">
        {searchParams.paid === 'ach'
          ? <><b>Thank you — your bank transfer is on its way.</b> Bank payments take 3–5 business days to arrive. {company} will see it as paid once your bank confirms it.</>
          : <><b>Thank you — your payment went through.</b> Stripe emails your receipt.</>}
      </div>
    </main>
  );
  if (balance <= 0) return <main className="public" style={style}>{head}<p className="card banner" role="status"><b>Paid in full.</b> Thank you!</p></main>;
  return (
    <main className="public" style={style}>
      {head}
      {searchParams.error && <p className="error" role="alert">{searchParams.error.slice(0, 300)}</p>}
      {acceptsOnline(org) ? (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Pay online</h2>
          <form method="post" action={`/api/pay/${params.token}/checkout`} style={{ margin: '0 0 12px' }}>
            <input type="hidden" name="method" value="ach" />
            <button className="btn" type="submit">Pay {usd(opts.ach.amount)} by bank transfer (ACH)</button>
            <p className="muted" style={{ margin: '6px 0 0' }}>No fee. Sign in to your bank or enter your account number. Takes 3–5 business days.</p>
          </form>
          <form method="post" action={`/api/pay/${params.token}/checkout`} style={{ margin: 0 }}>
            <input type="hidden" name="method" value="card" />
            <button className="btn ghost" type="submit">Pay {usd(opts.card.amount)} by card</button>
            <p className="muted" style={{ margin: '6px 0 0' }}>{opts.card.fee ? `Includes a ${feePct}% card processing fee (${usd(opts.card.fee)}). Pay by bank transfer to avoid it.` : 'No added fee.'}</p>
          </form>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>Payments are processed securely by Stripe and go directly to {company}. Your bank or card details are never shared with us.</p>
        </section>
      ) : <p className="card">{company} isn’t taking online payments right now.</p>}
      {org.remitInstructions && <section className="card"><h2 style={{ marginTop: 0 }}>{acceptsOnline(org) ? 'Other ways to pay' : 'How to pay'}</h2><p style={{ whiteSpace: 'pre-line', margin: 0 }}>{org.remitInstructions}</p></section>}
    </main>
  );
}
