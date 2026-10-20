import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { db } from '@/lib/db';
import { POST as ORDER, GET as LIST } from '@/app/api/background-checks/route';
import { GET as PACKAGES } from '@/app/api/background-checks/packages/route';
import { POST as HOOK } from '@/app/api/webhooks/checkr/route';
import { GET as CONNECT } from '@/app/api/screening/checkr/connect/route';
import { GET as CALLBACK } from '@/app/api/screening/checkr/callback/route';
import { POST as DISCONNECT } from '@/app/api/screening/checkr/disconnect/route';
import { POST as REFRESH } from '@/app/api/screening/checkr/refresh/route';

const RUN = `ck${Date.now()}`;
const CLIENT_ID = 'cid_test', CLIENT_SECRET = 'csecret_test';
const TOKEN = { a: `tok_a_${RUN}`, b: `tok_b_${RUN}` };
const ACCOUNT = { a: `acct_a_${RUN}`, b: `acct_b_${RUN}` };
let orgA: string, orgB: string, adminA: string, recA: string, adminB: string, cand: string, noEmail: string;
// Checkr's side: which tokens exist, whether each account is approved, and the state of each invitation and report.
const checkr = { approved: { [ACCOUNT.a]: false, [ACCOUNT.b]: true } as Record<string, boolean>, codes: { code_a: 'a', code_b: 'b', code_b2: 'b' } as Record<string, 'a' | 'b'>,
  invitations: {} as Record<string, { status: string; report_id?: string; account: string }>, reports: {} as Record<string, { status: string; result: string | null; candidate_id: string; account: string }> };
const calls: { url: string; method: string; body: unknown; token: string }[] = [];
const realFetch = globalThis.fetch;
const as = (u: string, o: string) => { session.current = { user: { id: u, orgId: o } }; };
const req = (method: string, body?: object, url = 'http://x') => new Request(url, { method, body: body ? JSON.stringify(body) : undefined });
const sign = (raw: string, key = CLIENT_ID) => createHmac('sha256', key).update(raw).digest('hex');
const hook = (ev: object, key = CLIENT_ID) => { const raw = JSON.stringify(ev); return HOOK(new Request('http://x', { method: 'POST', headers: { 'x-checkr-signature': sign(raw, key) }, body: raw })); };
const json = async (r: Response) => r.json();
/** Connects a company the way an admin would: Connect → Checkr → back with a code. */
async function connectAs(user: string, org: string, code: string) {
  as(user, org);
  const go = await CONNECT(req('GET', undefined, 'http://x/api/screening/checkr/connect?mode=signin'));
  const state = new URL(go.headers.get('location')!).searchParams.get('state')!;
  return CALLBACK(new Request(`http://x/api/screening/checkr/callback?scope=read_write&code=${code}&state=${encodeURIComponent(state)}`));
}

beforeAll(async () => {
  const mkOrg = async (n: string) => (await db.organization.create({ data: { name: `Screen ${n}`, slug: `${n}-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  orgA = await mkOrg('a'); orgB = await mkOrg('b');
  const mk = async (who: string, org: string, role: 'ADMIN' | 'RECRUITER') => { const u = await db.user.create({ data: { email: `${who}@${RUN}.test`, name: who, passwordHash: 'x' } }); await db.membership.create({ data: { userId: u.id, organizationId: org, role } }); return u.id; };
  adminA = await mk('admina', orgA, 'ADMIN'); recA = await mk('reca', orgA, 'RECRUITER'); adminB = await mk('adminb', orgB, 'ADMIN');
  cand = (await db.candidate.create({ data: { organizationId: orgA, name: 'Maria de la Cruz', email: 'maria@x.test', phone: '4075550100' } })).id;
  noEmail = (await db.candidate.create({ data: { organizationId: orgA, name: 'No Email' } })).id;
  globalThis.fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const auth = (init.headers as Record<string, string> | undefined)?.Authorization ?? '';
    const token = auth ? Buffer.from(auth.replace('Basic ', ''), 'base64').toString().replace(/:$/, '') : '';
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method: init.method ?? 'GET', body, token });
    const ok = (o: object, status = 200) => new Response(JSON.stringify(o), { status });
    const account = token === TOKEN.a ? ACCOUNT.a : token === TOKEN.b ? ACCOUNT.b : null;
    const path = url.replace('https://api.checkr-staging.com', '');
    if (path === '/oauth/tokens') {
      const who = body.client_id === CLIENT_ID && body.client_secret === CLIENT_SECRET ? checkr.codes[body.code] : undefined;
      return who ? ok({ access_token: TOKEN[who], scope: 'read_write', checkr_account_id: ACCOUNT[who] }) : ok({ error: 'invalid code' }, 400);
    }
    if (path === '/oauth/deauthorize') return ok({});
    if (!account) return ok({ error: 'Unauthorized' }, 401);
    if (path === '/v1/account') return ok({ id: account, name: account === ACCOUNT.a ? 'Screen A LLC' : 'Screen B LLC', authorized: checkr.approved[account] });
    if (path === '/v1/packages') return ok({ data: [{ slug: 'tasker_standard', name: 'Standard' }] });
    if (path === '/v1/candidates') return ok({ id: `cc_${RUN}` }, 201);
    if (path === '/v1/invitations') { checkr.invitations[`inv_${RUN}`] = { status: 'pending', account }; return ok({ id: `inv_${RUN}`, invitation_url: 'https://apply.checkr.com/x' }, 201); }
    const inv = path.match(/^\/v1\/invitations\/(.+)$/); if (inv) { const i = checkr.invitations[inv[1]]; return i && i.account === account ? ok({ id: inv[1], ...i }) : ok({ error: 'Not found' }, 404); }
    const rep = path.match(/^\/v1\/reports\/(.+)$/); if (rep) { const r = checkr.reports[rep[1]]; return r && r.account === account ? ok({ id: rep[1], ...r }) : ok({ error: 'Not found' }, 404); }
    return ok({ error: 'unexpected' }, 404);
  }) as never;
});
beforeEach(() => { process.env.CHECKR_CLIENT_ID = CLIENT_ID; process.env.CHECKR_CLIENT_SECRET = CLIENT_SECRET; process.env.APP_URL = 'http://localhost:3000'; });
afterAll(async () => {
  globalThis.fetch = realFetch;
  delete process.env.CHECKR_CLIENT_ID; delete process.env.CHECKR_CLIENT_SECRET;
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('Checkr: each company connects its own account', () => {
  it('is off until the server has Checkr partner keys', async () => {
    delete process.env.CHECKR_CLIENT_ID;
    as(recA, orgA);
    expect(await json(await PACKAGES())).toMatchObject({ state: 'off', enabled: false, packages: [] });
    expect((await json(await ORDER(req('POST', { candidateId: cand, package: 'tasker_standard', state: 'FL' })))).error).toMatch(/aren’t set up on this server/);
  });

  it('asks for a connection before ordering, and only admins can connect', async () => {
    as(recA, orgA);
    expect(await json(await PACKAGES())).toMatchObject({ state: 'not_connected', admin: false });
    expect((await json(await ORDER(req('POST', { candidateId: cand, package: 'tasker_standard', state: 'FL' })))).error).toMatch(/Connect your company’s Checkr account first/);
    expect((await CONNECT(req('GET'))).status).toBe(403);
    as(adminA, orgA);
    const go = await CONNECT(req('GET', undefined, 'http://x/api/screening/checkr/connect?mode=signup'));
    expect(go.headers.get('location')).toMatch(/^https:\/\/partners\.checkr\.com\/authorize\/cid_test\/signup\?scope=read_write&state=/);
  });

  it('connects through Checkr’s redirect; ordering waits for Checkr’s approval', async () => {
    const back = await connectAs(adminA, orgA, 'code_a');
    expect(back.headers.get('location')).toBe('http://localhost:3000/app/settings?screening=pending#screening');
    const c = await db.checkrConnection.findFirstOrThrow({ where: { organizationId: orgA } });
    expect(c).toMatchObject({ accountId: ACCOUNT.a, accountName: 'Screen A LLC', credentialedAt: null });
    expect(c.accessTokenEnc).not.toContain(TOKEN.a); // sealed
    as(recA, orgA);
    expect(await json(await PACKAGES())).toMatchObject({ state: 'pending', enabled: false });
    expect((await json(await ORDER(req('POST', { candidateId: cand, package: 'tasker_standard', state: 'FL' })))).error).toMatch(/still approving/);
    // A state from another admin or company is refused.
    as(adminB, orgB);
    const stolen = new URL((await CONNECT(req('GET'))).headers.get('location')!).searchParams.get('state')!;
    as(adminA, orgA);
    expect((await CALLBACK(new Request(`http://x/cb?code=code_a&state=${encodeURIComponent(stolen)}`))).headers.get('location')).toMatch(/screening_error=That%20connection%20link%20expired/);
  });

  it('turns on when Checkr says the account is approved (checked with Checkr, not taken from the webhook)', async () => {
    // A webhook claiming approval changes nothing while Checkr still says no.
    expect(await json(await hook({ type: 'account.credentialed', data: { object: { id: ACCOUNT.a } } }))).toEqual({ ok: true, applied: true });
    expect((await db.checkrConnection.findFirstOrThrow({ where: { organizationId: orgA } })).credentialedAt).toBeNull();
    checkr.approved[ACCOUNT.a] = true;
    expect((await hook({ type: 'account.credentialed', data: { object: { id: ACCOUNT.a } } }, 'wrong')).status).toBe(401);
    await hook({ type: 'account.credentialed', data: { object: { id: ACCOUNT.a } } });
    expect((await db.checkrConnection.findFirstOrThrow({ where: { organizationId: orgA } })).credentialedAt).not.toBeNull();
    expect(await db.activity.count({ where: { organizationId: orgA, text: { contains: 'Checkr approved your company' } } })).toBe(1);
    as(adminA, orgA);
    expect(await json(await REFRESH())).toEqual({ ready: true });
  });

  it('orders under the company’s own account with only name, email and work location', async () => {
    as(recA, orgA);
    expect(await json(await PACKAGES())).toMatchObject({ state: 'ready', packages: [{ slug: 'tasker_standard', name: 'Standard' }] });
    expect((await json(await ORDER(req('POST', { candidateId: noEmail, package: 'tasker_standard', state: 'FL' })))).error).toBe('Add No Email’s email first — Checkr sends them the consent form.');
    calls.length = 0;
    expect((await ORDER(req('POST', { candidateId: cand, package: 'tasker_standard', state: 'FL', city: 'Orlando' }))).status).toBe(201);
    expect(calls.map((c) => [c.method, c.url.replace('https://api.checkr-staging.com', '')])).toEqual([['POST', '/v1/candidates'], ['POST', '/v1/invitations']]);
    expect(calls.every((c) => c.token === TOKEN.a)).toBe(true);
    expect(calls[0].body).toEqual({ first_name: 'Maria', last_name: 'de la Cruz', email: 'maria@x.test', custom_id: cand });
    expect(calls[1].body).toEqual({ candidate_id: `cc_${RUN}`, package: 'tasker_standard', work_locations: [{ country: 'US', state: 'FL', city: 'Orlando' }] });
    expect((await json(await ORDER(req('POST', { candidateId: cand, package: 'tasker_standard', state: 'FL' })))).error).toBe('Maria de la Cruz already has a background check in progress.');
    expect(await db.auditLog.count({ where: { organizationId: orgA, action: 'screening.order' } })).toBe(1);
  });

  it('one Checkr account can’t be connected to two companies', async () => {
    checkr.codes.code_a2 = 'a';
    const back = await connectAs(adminB, orgB, 'code_a2');
    expect(decodeURIComponent(back.headers.get('location')!)).toContain('already connected to another company');
    expect(await db.checkrConnection.count({ where: { organizationId: orgB } })).toBe(0);
  });

  it('follows status by reading it back from Checkr; clear adds a verified credential', async () => {
    // Checkr says the invitation is done; the webhook only points at it.
    checkr.invitations[`inv_${RUN}`] = { status: 'completed', report_id: `rep_${RUN}`, account: ACCOUNT.a };
    checkr.reports[`rep_${RUN}`] = { status: 'pending', result: null, candidate_id: `cc_${RUN}`, account: ACCOUNT.a };
    expect(await json(await hook({ type: 'invitation.completed', account_id: ACCOUNT.a, data: { object: { id: `inv_${RUN}` } } }))).toEqual({ ok: true, applied: true });
    expect(await db.backgroundCheck.findFirst({ where: { organizationId: orgA } })).toMatchObject({ status: 'pending', externalReportId: `rep_${RUN}` });
    // A webhook claiming "clear" while Checkr's report is still pending changes nothing.
    await hook({ type: 'report.completed', account_id: ACCOUNT.a, data: { object: { id: `rep_${RUN}`, status: 'complete', result: 'clear' } as never } });
    expect(await db.backgroundCheck.findFirst({ where: { organizationId: orgA } })).toMatchObject({ status: 'pending' });
    checkr.reports[`rep_${RUN}`] = { ...checkr.reports[`rep_${RUN}`], status: 'complete', result: 'clear' };
    await hook({ type: 'report.completed', account_id: ACCOUNT.a, data: { object: { id: `rep_${RUN}` } } });
    await hook({ type: 'report.completed', account_id: ACCOUNT.a, data: { object: { id: `rep_${RUN}` } } }); // Checkr retries
    expect(await db.backgroundCheck.findFirst({ where: { organizationId: orgA } })).toMatchObject({ status: 'clear' });
    expect(await db.credential.count({ where: { organizationId: orgA, candidateId: cand, type: 'Background check', verifyMethod: 'Checkr report' } })).toBe(1);
    as(recA, orgA);
    expect((await json(await LIST(new Request(`http://x?candidate=${cand}`)))).checks).toEqual([expect.objectContaining({ status: 'clear', package: 'tasker_standard' })]);
  });

  it('can’t be steered into another company’s checks', async () => {
    await connectAs(adminB, orgB, 'code_b');
    // Company B's account naming company A's report: Checkr won't show B that report, and A's check is untouched.
    expect(await json(await hook({ type: 'report.completed', account_id: ACCOUNT.b, data: { object: { id: `rep_${RUN}` } } }))).toEqual({ ok: true, applied: false });
    expect(await json(await hook({ type: 'report.completed', account_id: 'acct_unknown', data: { object: { id: `rep_${RUN}` } } }))).toEqual({ ok: true, applied: false });
    expect(await db.backgroundCheck.findFirst({ where: { organizationId: orgA } })).toMatchObject({ status: 'clear' });
    as(adminB, orgB);
    expect((await json(await LIST(new Request(`http://x?candidate=${cand}`)))).checks).toEqual([]);
  });

  it('flags “consider” for review with the FCRA reminder', async () => {
    await db.backgroundCheck.updateMany({ where: { organizationId: orgA }, data: { status: 'pending' } });
    checkr.reports[`rep_${RUN}`].result = 'consider';
    await hook({ type: 'report.completed', account_id: ACCOUNT.a, data: { object: { id: `rep_${RUN}` } } });
    expect(await db.backgroundCheck.findFirst({ where: { organizationId: orgA } })).toMatchObject({ status: 'consider' });
    expect(await db.activity.count({ where: { organizationId: orgA, text: { contains: 'FCRA adverse-action' } } })).toBe(1);
  });

  it('disconnects from here or from Checkr', async () => {
    as(adminA, orgA);
    calls.length = 0;
    expect((await DISCONNECT()).status).toBe(200);
    expect(calls.map((c) => [c.url.replace('https://api.checkr-staging.com', ''), c.token])).toEqual([['/oauth/deauthorize', TOKEN.a]]);
    expect(await db.checkrConnection.count({ where: { organizationId: orgA } })).toBe(0);
    expect(await db.backgroundCheck.count({ where: { organizationId: orgA } })).toBe(1); // history stays
    // Company B disconnects in Checkr's dashboard.
    expect(await json(await hook({ type: 'token.deauthorized', data: { object: { access_code: TOKEN.b } } }))).toEqual({ ok: true, applied: true });
    expect(await db.checkrConnection.count({ where: { organizationId: orgB } })).toBe(0);
    expect(await db.auditLog.count({ where: { organizationId: orgA, action: 'settings.screening' } })).toBe(2);
  });
});
