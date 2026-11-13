import type Stripe from 'stripe';
import type { Organization, User } from '@prisma/client';
import { db } from './db';
import { stripe, stripeEnabled } from './stripe';
import { HttpError, logActivity, tenantDb } from './tenant';
import { acceptsOnline, payUrl } from './pay-links';
import { audit } from './audit';
import { cardFeeCents, fromCents, usd } from './invoicing';
import { balanceCents, settleInvoice } from './invoicing-server';

/**
 * Clients pay invoices online. Each staffing firm connects its own Stripe account (a Standard account it owns), and
 * payments are direct charges on that account: the money goes straight to the firm, Preciops never holds it and takes
 * no cut. Bank transfers (ACH) carry no fee; card payments add the firm's card fee (0-3%), shown before paying.
 */
export { acceptsOnline, ensurePayToken, payUrl } from './pay-links';
export type PayMethod = 'ach' | 'card';
const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';

/** Settings → Payments: a Stripe onboarding link for the firm's account, creating the account the first time. */
export async function connectLink(org: Organization, user: User) {
  if (!stripeEnabled()) throw new HttpError(503, 'Online payments aren’t set up on this server yet (an administrator adds the Stripe keys).');
  let account = org.stripeConnectAccountId;
  if (!account) {
    const a = await stripe.accounts.create({
      type: 'standard', country: 'US', email: org.billingEmail ?? user.email,
      business_profile: { name: org.name, ...(org.website ? { url: org.website } : {}) }, metadata: { orgId: org.id },
    });
    account = a.id;
    await db.organization.update({ where: { id: org.id }, data: { stripeConnectAccountId: account, stripeConnectReady: false } });
    await audit(org.id, user, 'billing.payments_connect', 'Started connecting a Stripe account for online invoice payments');
  }
  const link = await stripe.accountLinks.create({
    account, type: 'account_onboarding',
    refresh_url: `${appUrl()}/api/payments/connect`, return_url: `${appUrl()}/api/payments/connect/return`,
  });
  return link.url;
}

/** Reads the connected account's status from Stripe and keeps it on the company. */
export async function refreshConnect(org: Pick<Organization, 'id' | 'stripeConnectAccountId'>) {
  if (!org.stripeConnectAccountId || !stripeEnabled()) return false;
  const a = await stripe.accounts.retrieve(org.stripeConnectAccountId);
  await db.organization.update({ where: { id: org.id }, data: { stripeConnectReady: !!a.charges_enabled } });
  return !!a.charges_enabled;
}

export async function disconnect(org: Organization, user: User) {
  if (!org.stripeConnectAccountId) throw new HttpError(409, 'No Stripe account is connected.');
  await db.organization.update({ where: { id: org.id }, data: { stripeConnectAccountId: null, stripeConnectReady: false, onlinePayments: false } });
  const text = 'Disconnected Stripe: invoices no longer offer online payment (the Stripe account and its money stay with you)';
  await logActivity(org.id, text, user.id);
  await audit(org.id, user, 'billing.payments_disconnect', text);
}

/** The invoice behind a payment link, with its company. Null when the link is unknown. */
export async function invoiceForToken(token: string) {
  if (!/^[\w-]{20,100}$/.test(token)) return null;
  const hit = await db.invoice.findUnique({ where: { payToken: token }, select: { id: true, organizationId: true } });
  if (!hit) return null;
  const org = await db.organization.findUnique({ where: { id: hit.organizationId } });
  if (!org) return null;
  const tdb = tenantDb(org.id);
  const inv = await tdb.invoice.findFirst({ where: { id: hit.id }, include: { client: { select: { name: true } } } });
  return inv ? { org, tdb, inv } : null;
}

/** What paying the balance costs by each method, in cents. */
export function payOptions(org: Pick<Organization, 'cardFeePct'>, balance: number) {
  const fee = cardFeeCents(balance, Number(org.cardFeePct));
  return { ach: { amount: balance, fee: 0 }, card: { amount: balance + fee, fee } };
}

/** Starts Stripe Checkout on the firm's account for the invoice's balance. Returns the page to send the client to. */
export async function startCheckout(token: string, method: PayMethod) {
  const found = await invoiceForToken(token);
  if (!found) throw new HttpError(404, 'This payment link isn’t valid. Ask for a new invoice email.');
  const { org, inv } = found;
  if (!acceptsOnline(org)) throw new HttpError(409, `${org.shortName ?? org.name} isn’t taking online payments right now. The invoice lists other ways to pay.`);
  if (inv.status === 'VOID') throw new HttpError(409, 'This invoice was voided, so there’s nothing to pay.');
  const balance = balanceCents(inv);
  if (balance <= 0) throw new HttpError(409, 'This invoice is already paid. Thank you!');
  const fee = method === 'card' ? payOptions(org, balance).card.fee : 0;
  const company = org.shortName ?? org.name;
  const meta = { orgId: org.id, invoiceId: inv.id, invoiceCents: String(balance), feeCents: String(fee), method };
  const s = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: [method === 'card' ? 'card' : 'us_bank_account'],
    line_items: [
      { quantity: 1, price_data: { currency: 'usd', unit_amount: balance, product_data: { name: `Invoice ${inv.number}`, description: `${company} — staffing services for ${inv.client.name}` } } },
      ...(fee ? [{ quantity: 1, price_data: { currency: 'usd', unit_amount: fee, product_data: { name: `Card processing fee (${Number(org.cardFeePct)}%)`, description: 'Pay by bank transfer to avoid this fee.' } } }] : []),
    ],
    metadata: meta,
    payment_intent_data: { metadata: meta, description: `Invoice ${inv.number} (${inv.client.name})` },
    success_url: `${payUrl(token)}?paid=${method}`, cancel_url: payUrl(token),
  }, { stripeAccount: org.stripeConnectAccountId! });
  if (!s.url) throw new HttpError(502, 'Stripe didn’t open a payment page. Try again in a minute.');
  return s.url;
}

/** Records a completed online payment on its invoice. Safe to call more than once for the same payment. */
export async function recordOnlinePayment(account: string, s: Stripe.Checkout.Session) {
  const m = s.metadata ?? {};
  const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
  if (!m.orgId || !m.invoiceId || !pi) return 'ignored';
  const org = await db.organization.findUnique({ where: { id: m.orgId } });
  // The event must come from the account this company connected, or it isn't theirs.
  if (!org || org.stripeConnectAccountId !== account) return 'ignored';
  const tdb = tenantDb(org.id);
  if (await tdb.payment.findFirst({ where: { stripePaymentId: pi }, select: { id: true } })) return 'duplicate';
  const inv = await tdb.invoice.findFirst({ where: { id: m.invoiceId } });
  if (!inv) return 'ignored';
  const fee = Number(m.feeCents) || 0;
  const paid = (s.amount_total ?? 0) - fee; // what goes against the invoice; the card fee doesn't
  if (paid <= 0) return 'ignored';
  const method = m.method === 'card' ? 'card' : 'ach';
  const before = balanceCents(inv);
  try {
    await tdb.payment.create({ data: {
      invoiceId: inv.id, amount: fromCents(paid), receivedOn: new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z'), method,
      reference: pi, stripePaymentId: pi, notes: `Paid online${fee ? ` by card (plus ${usd(fee)} card fee)` : ' by bank transfer'}`,
    } as never });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') return 'duplicate'; // two deliveries of one event at once
    throw e;
  }
  await settleInvoice(tdb, inv.id);
  const over = paid - before;
  await logActivity(org.id, `${inv.number}: received ${usd(paid)} online by ${method === 'card' ? 'card' : 'bank transfer'}${over > 0 ? ` — ${usd(over)} more than was owed (a manual payment may have arrived too; refund or credit it)` : ''}`);
  if (inv.voidedAt) await logActivity(org.id, `${inv.number} was void but received an online payment of ${usd(paid)}. Refund it in Stripe or apply it to another invoice.`);
  return 'recorded';
}

/** Events from connected accounts (the firms' own Stripe accounts). */
export async function handleConnectEvent(event: Stripe.Event) {
  const account = event.account;
  if (!account) return 'ignored';
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object as Stripe.Checkout.Session;
      // Cards are paid now; a bank transfer takes a few days and arrives as async_payment_succeeded.
      if (s.payment_status === 'paid') return recordOnlinePayment(account, s);
      if (s.metadata?.orgId && s.metadata.invoiceId) {
        const org = await db.organization.findUnique({ where: { id: s.metadata.orgId }, select: { id: true, stripeConnectAccountId: true } });
        if (org?.stripeConnectAccountId === account) {
          const inv = await tenantDb(org.id).invoice.findFirst({ where: { id: s.metadata.invoiceId }, select: { number: true } });
          if (inv) await logActivity(org.id, `${inv.number}: the client started a ${usd(s.amount_total ?? 0)} bank transfer. It’s recorded when the bank confirms it (usually 3–5 business days).`);
        }
      }
      return 'pending';
    }
    case 'checkout.session.async_payment_succeeded':
      return recordOnlinePayment(account, event.data.object as Stripe.Checkout.Session);
    case 'checkout.session.async_payment_failed': {
      const s = event.data.object as Stripe.Checkout.Session;
      const org = s.metadata?.orgId ? await db.organization.findUnique({ where: { id: s.metadata.orgId }, select: { id: true, stripeConnectAccountId: true } }) : null;
      if (org?.stripeConnectAccountId === account && s.metadata?.invoiceId) {
        const inv = await tenantDb(org.id).invoice.findFirst({ where: { id: s.metadata.invoiceId }, select: { number: true } });
        if (inv) await logActivity(org.id, `${inv.number}: the client’s ${usd(s.amount_total ?? 0)} bank transfer failed. The invoice is still open.`);
      }
      return 'failed';
    }
    case 'account.updated': {
      const a = event.data.object as Stripe.Account;
      await db.organization.updateMany({ where: { stripeConnectAccountId: a.id }, data: { stripeConnectReady: !!a.charges_enabled } });
      return 'account';
    }
    case 'account.application.deauthorized':
      await db.organization.updateMany({ where: { stripeConnectAccountId: account }, data: { stripeConnectAccountId: null, stripeConnectReady: false, onlinePayments: false } });
      return 'deauthorized';
  }
  return 'ignored';
}

