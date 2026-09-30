import type { AccountingConnection, Organization, User } from '@prisma/client';
import { HttpError, logActivity, tenantDb, type TenantDb } from './tenant';
import { audit } from './audit';
import { open, seal } from './secret-box';
import { cents, toCents } from './invoicing';
import { OT_MULTIPLIER } from './weeks';

/**
 * QuickBooks Online and Xero: connect with OAuth, then push invoices (and payments) so the books match.
 * Each provider is on when its client id and secret are set. Tokens are sealed at rest and refreshed as needed.
 */
export type Provider = 'quickbooks' | 'xero';
export const PROVIDERS: Record<Provider, { name: string }> = { quickbooks: { name: 'QuickBooks Online' }, xero: { name: 'Xero' } };
export const isProvider = (p: string): p is Provider => p === 'quickbooks' || p === 'xero';

const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';
const redirectUri = (p: Provider) => `${appUrl()}/api/integrations/${p}/callback`;
const creds = (p: Provider) => p === 'quickbooks'
  ? { id: process.env.QUICKBOOKS_CLIENT_ID, secret: process.env.QUICKBOOKS_CLIENT_SECRET }
  : { id: process.env.XERO_CLIENT_ID, secret: process.env.XERO_CLIENT_SECRET };
export const providerEnabled = (p: Provider) => !!(creds(p).id && creds(p).secret);
const basic = (p: Provider) => `Basic ${Buffer.from(`${creds(p).id}:${creds(p).secret}`).toString('base64')}`;
const qboBase = () => (process.env.QUICKBOOKS_ENV === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com');
const TOKEN_URL: Record<Provider, string> = { quickbooks: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', xero: 'https://identity.xero.com/connect/token' };

export function authorizeUrl(p: Provider, state: string) {
  const q = new URLSearchParams({ client_id: creds(p).id!, response_type: 'code', redirect_uri: redirectUri(p), state,
    scope: p === 'quickbooks' ? 'com.intuit.quickbooks.accounting' : 'openid profile email accounting.transactions accounting.contacts offline_access' });
  return `${p === 'quickbooks' ? 'https://appcenter.intuit.com/connect/oauth2' : 'https://login.xero.com/identity/connect/authorize'}?${q}`;
}

type Tokens = { access_token: string; refresh_token: string; expires_in: number };
async function tokenRequest(p: Provider, form: Record<string, string>): Promise<Tokens> {
  const r = await fetch(TOKEN_URL[p], { method: 'POST', headers: { Authorization: basic(p), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(form), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new HttpError(502, `${PROVIDERS[p].name} refused the connection (${j.error_description ?? j.error ?? r.status}). Try connecting again.`);
  return j;
}

/** Finishes OAuth: exchanges the code and stores the connection (replacing an earlier one). */
export async function connect(org: Organization, user: User, p: Provider, code: string, realmId: string | null) {
  const t = await tokenRequest(p, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(p) });
  let tenant = realmId, tenantName: string | null = null;
  if (p === 'xero') {
    const r = await fetch('https://api.xero.com/connections', { headers: { Authorization: `Bearer ${t.access_token}`, Accept: 'application/json' } });
    const list = (await r.json().catch(() => [])) as { tenantId: string; tenantName: string; tenantType: string }[];
    const org0 = list.find((x) => x.tenantType === 'ORGANISATION') ?? list[0];
    if (!org0) throw new HttpError(502, 'No Xero organisation was shared. Connect again and choose one.');
    tenant = org0.tenantId; tenantName = org0.tenantName;
  }
  if (!tenant) throw new HttpError(400, 'QuickBooks didn’t say which company to use. Try connecting again.');
  const data = { externalTenant: tenant, tenantName, accessTokenEnc: seal(t.access_token), refreshTokenEnc: seal(t.refresh_token), expiresAt: new Date(Date.now() + (t.expires_in - 60) * 1000), connectedById: user.id, connectedAt: new Date(), lastError: null };
  const tdb = tenantDb(org.id);
  await tdb.$transaction(async (tx) => {
    await tx.accountingConnection.deleteMany({ where: { provider: p } });
    await tx.accountingConnection.create({ data: { provider: p, ...data } as never });
    if (p === 'quickbooks' || p === 'xero') await tx.externalRef.deleteMany({ where: { provider: p, kind: { in: ['customer', 'item', 'account'] } } }); // a different company may be connected now
  });
  await audit(org.id, user, 'settings.accounting', `Connected ${PROVIDERS[p].name}${tenantName ? ` (${tenantName})` : ''}`);
}

export async function disconnect(org: Organization, user: User, p: Provider) {
  const tdb = tenantDb(org.id);
  const c = await tdb.accountingConnection.findFirst({ where: { provider: p } });
  if (!c) return;
  // Best effort: tell the provider to revoke the refresh token.
  const revoke = p === 'quickbooks' ? 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke' : 'https://identity.xero.com/connect/revocation';
  await fetch(revoke, { method: 'POST', headers: { Authorization: basic(p), 'Content-Type': p === 'quickbooks' ? 'application/json' : 'application/x-www-form-urlencoded' },
    body: p === 'quickbooks' ? JSON.stringify({ token: open(c.refreshTokenEnc) }) : new URLSearchParams({ token: open(c.refreshTokenEnc) }) }).catch(() => {});
  await tdb.accountingConnection.deleteMany({ where: { provider: p } });
  await audit(org.id, user, 'settings.accounting', `Disconnected ${PROVIDERS[p].name}`);
}

/** A fresh access token (refreshing, and saving the rotated refresh token, when it's about to expire). */
async function accessToken(tdb: TenantDb, c: AccountingConnection) {
  if (c.expiresAt.getTime() > Date.now() + 30e3) return open(c.accessTokenEnc);
  const p = c.provider as Provider;
  const t = await tokenRequest(p, { grant_type: 'refresh_token', refresh_token: open(c.refreshTokenEnc) });
  await tdb.accountingConnection.updateMany({ where: { id: c.id }, data: { accessTokenEnc: seal(t.access_token), refreshTokenEnc: seal(t.refresh_token), expiresAt: new Date(Date.now() + (t.expires_in - 60) * 1000) } });
  return t.access_token;
}

async function api<T>(tdb: TenantDb, c: AccountingConnection, method: string, path: string, body?: object): Promise<T> {
  const token = await accessToken(tdb, c);
  const url = c.provider === 'quickbooks' ? `${qboBase()}/v3/company/${c.externalTenant}${path}${path.includes('?') ? '&' : '?'}minorversion=70` : `https://api.xero.com/api.xro/2.0${path}`;
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', ...(c.provider === 'xero' ? { 'xero-tenant-id': c.externalTenant } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.Fault?.Error?.[0]?.Detail ?? j?.Fault?.Error?.[0]?.Message ?? j?.Elements?.[0]?.ValidationErrors?.[0]?.Message ?? j?.Message ?? `HTTP ${r.status}`;
    throw new HttpError(502, `${PROVIDERS[c.provider as Provider].name}: ${msg}`);
  }
  return j as T;
}

async function ref(tdb: TenantDb, provider: string, kind: string, localId: string) {
  return (await tdb.externalRef.findFirst({ where: { provider, kind, localId } }))?.externalId ?? null;
}
const remember = (tdb: TenantDb, provider: string, kind: string, localId: string, externalId: string) =>
  tdb.externalRef.create({ data: { provider, kind, localId, externalId } as never }).catch(() => undefined);
const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// ---- QuickBooks ----
async function qboCustomer(tdb: TenantDb, c: AccountingConnection, client: { id: string; name: string }) {
  const known = await ref(tdb, 'quickbooks', 'customer', client.id);
  if (known) return known;
  const found = await api<{ QueryResponse: { Customer?: { Id: string }[] } }>(tdb, c, 'GET', `/query?query=${encodeURIComponent(`select Id from Customer where DisplayName = '${q(client.name)}'`)}`);
  const id = found.QueryResponse.Customer?.[0]?.Id ?? (await api<{ Customer: { Id: string } }>(tdb, c, 'POST', '/customer', { DisplayName: client.name })).Customer.Id;
  await remember(tdb, 'quickbooks', 'customer', client.id, id);
  return id;
}
/** The "Staffing services" service item every line is booked to (created once, against the first income account). */
async function qboItem(tdb: TenantDb, c: AccountingConnection) {
  const known = await ref(tdb, 'quickbooks', 'item', 'staffing');
  if (known) return known;
  const found = await api<{ QueryResponse: { Item?: { Id: string }[] } }>(tdb, c, 'GET', `/query?query=${encodeURIComponent("select Id from Item where Name = 'Staffing services'")}`);
  let id = found.QueryResponse.Item?.[0]?.Id;
  if (!id) {
    const acct = await api<{ QueryResponse: { Account?: { Id: string }[] } }>(tdb, c, 'GET', `/query?query=${encodeURIComponent("select Id from Account where AccountType = 'Income' maxresults 1")}`);
    const income = acct.QueryResponse.Account?.[0]?.Id;
    if (!income) throw new HttpError(409, 'QuickBooks has no income account to book staffing revenue to. Add one in QuickBooks first.');
    id = (await api<{ Item: { Id: string } }>(tdb, c, 'POST', '/item', { Name: 'Staffing services', Type: 'Service', IncomeAccountRef: { value: income } })).Item.Id;
  }
  await remember(tdb, 'quickbooks', 'item', 'staffing', id);
  return id;
}

type Inv = Awaited<ReturnType<typeof loadForSync>>;
async function loadForSync(tdb: TenantDb, id: string) {
  const inv = await tdb.invoice.findFirst({ where: { id }, include: { client: { select: { id: true, name: true } }, lines: { orderBy: [{ weekEnding: 'asc' }, { worker: 'asc' }] }, payments: true } });
  if (!inv) throw new HttpError(404, 'That invoice was deleted.');
  return inv;
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** Regular and overtime as separate lines (hours × rate), so the accounting system's totals match ours to the cent. */
export function splitLines(inv: Pick<Inv, 'lines'>) {
  return inv.lines.flatMap((l) => {
    const reg = Number(l.regularHours), ot = Number(l.overtimeHours), rate = Number(l.rate);
    const label = `${l.worker} — ${l.description}${l.weekEnding ? `, week ending ${ymd(l.weekEnding)}` : ''}`;
    return [
      ...(reg ? [{ description: label, qty: reg, rate, cents: cents(reg * rate) }] : []),
      ...(ot ? [{ description: `${label} (overtime)`, qty: ot, rate: Math.round(rate * OT_MULTIPLIER * 10000) / 10000, cents: cents(ot * rate * OT_MULTIPLIER) }] : []),
    ];
  });
}

async function pushInvoice(tdb: TenantDb, c: AccountingConnection, inv: Inv) {
  const p = c.provider as Provider;
  const lines = splitLines(inv);
  if (lines.reduce((s, l) => s + l.cents, 0) !== toCents(inv.total)) throw new HttpError(409, `${inv.number}’s lines don’t add up to its total; it wasn’t sent.`);
  let externalId: string;
  if (p === 'quickbooks') {
    const [customer, item] = [await qboCustomer(tdb, c, inv.client), await qboItem(tdb, c)];
    externalId = (await api<{ Invoice: { Id: string } }>(tdb, c, 'POST', '/invoice', {
      CustomerRef: { value: customer }, DocNumber: inv.number.slice(0, 21), TxnDate: ymd(inv.issueDate), DueDate: ymd(inv.dueDate), PrivateNote: `From Preciops ${inv.number}`,
      Line: lines.map((l) => ({ Amount: l.cents / 100, DetailType: 'SalesItemLineDetail', Description: l.description.slice(0, 4000), SalesItemLineDetail: { ItemRef: { value: item }, Qty: l.qty, UnitPrice: l.rate } })),
    })).Invoice.Id;
  } else {
    externalId = (await api<{ Invoices: { InvoiceID: string }[] }>(tdb, c, 'POST', '/Invoices', { Invoices: [{
      Type: 'ACCREC', Contact: { Name: inv.client.name }, Date: ymd(inv.issueDate), DueDate: ymd(inv.dueDate), InvoiceNumber: inv.number, Reference: 'Preciops',
      LineAmountTypes: 'NoTax', Status: 'AUTHORISED',
      LineItems: lines.map((l) => ({ Description: l.description, Quantity: l.qty, UnitAmount: l.rate, LineAmount: l.cents / 100, AccountCode: process.env.XERO_SALES_ACCOUNT || '200' })),
    }] })).Invoices[0].InvoiceID;
  }
  await remember(tdb, p, 'invoice', inv.id, externalId);
  return externalId;
}

async function pushPayments(tdb: TenantDb, c: AccountingConnection, inv: Inv, externalInvoice: string) {
  const p = c.provider as Provider;
  if (p === 'xero' && !process.env.XERO_BANK_ACCOUNT) return 0; // Xero needs to know which bank account received it
  let n = 0;
  for (const pay of inv.payments) {
    if (await ref(tdb, p, 'payment', pay.id)) continue;
    const id = p === 'quickbooks'
      ? (await api<{ Payment: { Id: string } }>(tdb, c, 'POST', '/payment', { CustomerRef: { value: await qboCustomer(tdb, c, inv.client) }, TotalAmt: Number(pay.amount), TxnDate: ymd(pay.receivedOn), PaymentRefNum: pay.reference?.slice(0, 21) || undefined,
          Line: [{ Amount: Number(pay.amount), LinkedTxn: [{ TxnId: externalInvoice, TxnType: 'Invoice' }] }] })).Payment.Id
      : (await api<{ Payments: { PaymentID: string }[] }>(tdb, c, 'PUT', '/Payments', { Payments: [{ Invoice: { InvoiceID: externalInvoice }, Account: { Code: process.env.XERO_BANK_ACCOUNT }, Date: ymd(pay.receivedOn), Amount: Number(pay.amount), Reference: pay.reference ?? undefined }] })).Payments[0].PaymentID;
    await remember(tdb, p, 'payment', pay.id, id);
    n++;
  }
  return n;
}

/** Sends invoices (all unsent non-void ones, or the given ones) and their payments to the connected system. */
export async function syncInvoices(org: Organization, user: User | null, invoiceIds?: string[]) {
  const tdb = tenantDb(org.id);
  const c = await tdb.accountingConnection.findFirst({ orderBy: { connectedAt: 'desc' } });
  if (!c) throw new HttpError(409, 'Connect QuickBooks or Xero in Settings first.');
  const p = c.provider as Provider;
  const ids = invoiceIds ?? (await tdb.invoice.findMany({ where: { status: { not: 'VOID' } }, select: { id: true }, orderBy: { issueDate: 'asc' }, take: 200 })).map((i) => i.id);
  const out = { invoices: 0, payments: 0, failed: [] as string[] };
  for (const id of ids) {
    const inv = await loadForSync(tdb, id);
    if (inv.status === 'VOID') continue;
    try {
      let ext = await ref(tdb, p, 'invoice', inv.id);
      if (!ext) { ext = await pushInvoice(tdb, c, inv); out.invoices++; }
      out.payments += await pushPayments(tdb, c, inv, ext);
      await tdb.invoice.updateMany({ where: { id: inv.id }, data: { syncedAt: new Date(), syncError: null } });
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      await tdb.invoice.updateMany({ where: { id: inv.id }, data: { syncError: msg } });
      out.failed.push(`${inv.number}: ${msg}`);
    }
  }
  await tdb.accountingConnection.updateMany({ where: { id: c.id }, data: { lastSyncAt: new Date(), lastError: out.failed[0] ?? null } });
  if (out.invoices || out.payments) await logActivity(org.id, `Sent ${out.invoices} invoice${out.invoices === 1 ? '' : 's'} and ${out.payments} payment${out.payments === 1 ? '' : 's'} to ${PROVIDERS[p].name}`, user?.id);
  return { provider: PROVIDERS[p].name, ...out };
}
