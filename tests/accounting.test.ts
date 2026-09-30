import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { db } from '@/lib/db';
import { open, readState, seal, signState } from '@/lib/secret-box';
import { splitLines } from '@/lib/accounting';
import { GET as CONNECT } from '@/app/api/integrations/[provider]/connect/route';
import { GET as CALLBACK } from '@/app/api/integrations/[provider]/callback/route';
import { POST as SYNC } from '@/app/api/integrations/sync/route';
import { POST as DISCONNECT } from '@/app/api/integrations/[provider]/disconnect/route';

describe('secret box', () => {
  it('seals tokens and detects tampering', () => {
    const s = seal('refresh-token-abc');
    expect(s).not.toContain('refresh-token-abc');
    expect(open(s)).toBe('refresh-token-abc');
    const [v, iv, tag, enc] = s.split('.');
    expect(() => open([v, iv, tag, `${enc.slice(0, -2)}AA`].join('.'))).toThrow();
  });
  it('signs short-lived state', () => {
    const st = signState({ org: 'o1' });
    expect(readState(st)).toMatchObject({ org: 'o1' });
    expect(readState(`${st.split('.')[0]}.forged`)).toBeNull();
    expect(readState(signState({ org: 'o1' }, -1))).toBeNull();
  });
  it('splits invoice lines so they add up to the cent', () => {
    const lines = splitLines({ lines: [{ worker: 'Ana', description: 'Nurse', weekEnding: new Date('2026-09-20'), regularHours: 7.25 as never, overtimeHours: 3 as never, rate: 33.33 as never }] as never });
    expect(lines).toEqual([
      { description: 'Ana — Nurse, week ending 2026-09-20', qty: 7.25, rate: 33.33, cents: 24164 },
      { description: 'Ana — Nurse, week ending 2026-09-20 (overtime)', qty: 3, rate: 49.995, cents: 14999 },
    ]);
  });
});

const RUN = `ac${Date.now()}`;
let org: string, admin: string, rec: string, inv: string;
const calls: { url: string; method: string; body: string }[] = [];
const realFetch = globalThis.fetch;
const as = (u: string) => { session.current = { user: { id: u, orgId: org } }; };
const req = (url: string, method = 'GET', body?: object) => new Request(url, { method, body: body ? JSON.stringify(body) : undefined });
let tokenExpiresIn = 3600, failInvoice = false;

beforeAll(async () => {
  process.env.QUICKBOOKS_CLIENT_ID = 'qb-id'; process.env.QUICKBOOKS_CLIENT_SECRET = 'qb-secret';
  org = (await db.organization.create({ data: { name: 'Books Co', slug: `b-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [admin, rec] = await Promise.all([u('admin'), u('rec')]);
  await db.membership.createMany({ data: [{ userId: admin, organizationId: org, role: 'ADMIN' }, { userId: rec, organizationId: org, role: 'RECRUITER' }] });
  const client = await db.client.create({ data: { organizationId: org, name: "O'Brien Logistics" } });
  inv = (await db.invoice.create({ data: { organizationId: org, clientId: client.id, number: 'INV-2026-0001', issueDate: new Date('2026-09-21'), dueDate: new Date('2026-10-21'), periodStart: new Date('2026-09-14'), periodEnd: new Date('2026-09-20'), terms: 'Net 30', total: 1425, status: 'SENT',
    lines: { create: [{ organizationId: org, worker: 'Ana Diaz', description: 'Forklift Operator', weekEnding: new Date('2026-09-20'), regularHours: 40, overtimeHours: 5, rate: 30, amount: 1425 }] } } })).id;
  await db.payment.create({ data: { organizationId: org, invoiceId: inv, amount: 500, receivedOn: new Date('2026-09-25'), method: 'check', reference: '1042' } });
  globalThis.fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : '';
    calls.push({ url, method: init.method ?? 'GET', body });
    const J = (x: object, status = 200) => new Response(JSON.stringify(x), { status });
    if (url.includes('/oauth2/v1/tokens/bearer')) return J({ access_token: `at_${calls.length}`, refresh_token: `rt_${calls.length}`, expires_in: tokenExpiresIn });
    if (url.includes('/query?')) return J({ QueryResponse: decodeURIComponent(url).includes('from Account') ? { Account: [{ Id: '79' }] } : {} });
    if (url.includes('/customer?')) return J({ Customer: { Id: 'C1' } });
    if (url.includes('/item?')) return J({ Item: { Id: 'I1' } });
    if (url.includes('/invoice?')) return failInvoice ? J({ Fault: { Error: [{ Detail: 'Duplicate Document Number Error' }] } }, 400) : J({ Invoice: { Id: 'QI1' } });
    if (url.includes('/payment?')) return J({ Payment: { Id: 'QP1' } });
    return J({}, 404);
  }) as never;
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('QuickBooks', () => {
  it('connects through OAuth with a state tied to the admin', async () => {
    as(rec);
    expect((await CONNECT(req('http://x'), { params: { provider: 'quickbooks' } })).status).toBe(403);
    as(admin);
    const r = await CONNECT(req('http://x'), { params: { provider: 'quickbooks' } });
    expect(r.status).toBe(302);
    const to = new URL(r.headers.get('location')!);
    expect(to.origin + to.pathname).toBe('https://appcenter.intuit.com/connect/oauth2');
    expect(to.searchParams.get('scope')).toBe('com.intuit.quickbooks.accounting');
    const state = to.searchParams.get('state')!;
    // A forged state is refused.
    const bad = await CALLBACK(req(`http://x?code=abc&realmId=123&state=${encodeURIComponent(signState({ org: 'other', user: admin, p: 'quickbooks' }))}`), { params: { provider: 'quickbooks' } });
    expect(decodeURIComponent(bad.headers.get('location')!)).toContain('accounting_error=That connection link expired');
    const ok = await CALLBACK(req(`http://x?code=abc&realmId=123456&state=${encodeURIComponent(state)}`), { params: { provider: 'quickbooks' } });
    expect(ok.headers.get('location')).toContain('accounting=connected');
    const c = await db.accountingConnection.findFirst({ where: { organizationId: org } });
    expect(c).toMatchObject({ provider: 'quickbooks', externalTenant: '123456' });
    expect(c!.accessTokenEnc).not.toContain('at_');
    expect(await db.auditLog.count({ where: { organizationId: org, action: 'settings.accounting' } })).toBe(1);
  });

  it('records a failed push on the invoice', async () => {
    failInvoice = true;
    const r = await (await SYNC(req('http://x', 'POST', {}))).json();
    expect(r.failed).toEqual(['INV-2026-0001: QuickBooks Online: Duplicate Document Number Error']);
    // The customer was looked up by name, with the apostrophe escaped, and is remembered for next time.
    expect(decodeURIComponent(calls.find((c) => decodeURIComponent(c.url).includes('from Customer'))!.url)).toContain("DisplayName = 'O\\'Brien Logistics'");
    expect((await db.invoice.findUnique({ where: { id: inv } }))!.syncError).toBe('QuickBooks Online: Duplicate Document Number Error');
    failInvoice = false;
  });

  it('pushes the invoice with split lines, then the payment, once', async () => {
    calls.length = 0;
    const r = await (await SYNC(req('http://x', 'POST', {}))).json();
    expect(r).toMatchObject({ provider: 'QuickBooks Online', invoices: 1, payments: 1, failed: [] });
    const invCall = calls.find((c) => c.url.includes('/invoice?'))!;
    expect(invCall.url).toMatch(/^https:\/\/sandbox-quickbooks\.api\.intuit\.com\/v3\/company\/123456\/invoice\?minorversion=/);
    const body = JSON.parse(invCall.body);
    expect(body).toMatchObject({ CustomerRef: { value: 'C1' }, DocNumber: 'INV-2026-0001', TxnDate: '2026-09-21', DueDate: '2026-10-21' });
    expect(body.Line.map((l: { Amount: number; SalesItemLineDetail: { Qty: number; UnitPrice: number } }) => [l.Amount, l.SalesItemLineDetail.Qty, l.SalesItemLineDetail.UnitPrice])).toEqual([[1200, 40, 30], [225, 5, 45]]);
    expect(calls.some((c) => decodeURIComponent(c.url).includes('from Customer'))).toBe(false);
    expect(JSON.parse(calls.find((c) => c.url.includes('/payment?'))!.body)).toMatchObject({ TotalAmt: 500, Line: [{ LinkedTxn: [{ TxnId: 'QI1', TxnType: 'Invoice' }] }] });
    expect(await db.invoice.findUnique({ where: { id: inv } })).toMatchObject({ syncError: null });
    calls.length = 0;
    expect(await (await SYNC(req('http://x', 'POST', {}))).json()).toMatchObject({ invoices: 0, payments: 0 });
    expect(calls.filter((c) => /\/(invoice|payment|customer)\?/.test(c.url))).toHaveLength(0);
  });

  it('refreshes an expired token and saves the new one', async () => {
    await db.accountingConnection.updateMany({ where: { organizationId: org }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await db.payment.create({ data: { organizationId: org, invoiceId: inv, amount: 100, receivedOn: new Date('2026-09-28'), method: 'ach' } });
    calls.length = 0;
    expect((await (await SYNC(req('http://x', 'POST', { invoiceIds: [inv] }))).json()).payments).toBe(1);
    expect(calls[0].url).toContain('/oauth2/v1/tokens/bearer');
    expect(calls[0].body).toContain('grant_type=refresh_token');
    expect((await db.accountingConnection.findFirst({ where: { organizationId: org } }))!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('disconnects', async () => {
    expect((await DISCONNECT(req('http://x', 'POST'), { params: { provider: 'quickbooks' } })).status).toBe(200);
    expect(await db.accountingConnection.count({ where: { organizationId: org } })).toBe(0);
    expect((await (await SYNC(req('http://x', 'POST', {}))).json()).error).toBe('Connect QuickBooks or Xero in Settings first.');
  });
});
