import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string; via?: 'sso' } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { authOptions, SSO_REQUIRED } from '@/lib/auth';
import { checkDomains } from '@/lib/sso';
import { GET as STATUS, POST as SETUP, DELETE as TURN_OFF } from '@/app/api/sso/route';
import { POST as PORTAL } from '@/app/api/sso/portal/route';
import { POST as REFRESH } from '@/app/api/sso/refresh/route';
import { PATCH as REQUIRE } from '@/app/api/sso/require/route';
import { POST as START } from '@/app/api/auth/sso/start/route';
import { GET as CALLBACK } from '@/app/api/auth/sso/callback/route';
import { GET as JOBS } from '@/app/api/jobs/route';

const RUN = `sso${Date.now()}`;
const D = `acme-${RUN}.test`, OTHER = `beta-${RUN}.test`;
const PW = 'right-password-1';
let org: string, other: string, small: string, owner: string, admin: string, rec: string, outsider: string, otherAdmin: string;
// WorkOS's side: organizations, whether IT has finished the connection, and who the identity provider says signed in.
const workos = { orgs: {} as Record<string, { name: string; domains: string[] }>, active: false, codes: {} as Record<string, { email: string; organization_id: string }>, calls: [] as { method: string; path: string; body: unknown; auth: string }[] };
const realFetch = globalThis.fetch;
type Authorize = (c: Record<string, string>, r: { headers: Record<string, string> }) => Promise<unknown>;
const provider = (id: string) => (authOptions.providers.find((p) => ((p as { options?: { id?: string } }).options?.id ?? p.id) === id) as unknown as { options: { authorize: Authorize } }).options.authorize;
let ip = 0;
const password = (email: string) => provider('credentials')({ email, password: PW }, { headers: { 'x-forwarded-for': `10.9.${RUN.length}.${++ip}` } });
const as = (id: string, o = org, via?: 'sso') => { session.current = { user: { id, orgId: o, via } }; };
const req = (method: string, body?: unknown, url = 'http://x') => new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (r: Response) => ({ status: r.status, body: await r.json() });
const email = (who: string, d = D) => `${who}@${d}`;
/** The whole sign-in: start with an email, "sign in at the identity provider", come back, trade the ticket for a session. */
async function ssoSignIn(addr: string, idpEmail = addr) {
  const s = await json(await START(req('POST', { email: addr })));
  if (s.status !== 200) return { error: s.body.error as string };
  const u = new URL(s.body.url);
  const code = `code_${++ip}`;
  workos.codes[code] = { email: idpEmail, organization_id: u.searchParams.get('organization')! };
  const back = await CALLBACK(new Request(`http://x/api/auth/sso/callback?code=${code}&state=${encodeURIComponent(u.searchParams.get('state')!)}`));
  const loc = new URL(back.headers.get('location')!);
  if (loc.pathname !== '/sso') return { error: loc.searchParams.get('sso_error') };
  return { user: await provider('sso')({ ticket: loc.searchParams.get('ticket')! }, { headers: {} }), ticket: loc.searchParams.get('ticket')! };
}

beforeAll(async () => {
  const mkOrg = async (n: string, plan: 'enterprise' | 'growth') => (await db.organization.create({ data: { name: `${n} Co`, slug: `${n}-${RUN}`, plan, subscriptionStatus: 'active' } })).id;
  org = await mkOrg('acme', 'enterprise'); other = await mkOrg('beta', 'enterprise'); small = await mkOrg('small', 'growth');
  const hash = await bcrypt.hash(PW, 4);
  const mk = async (addr: string, o: string, role: 'OWNER' | 'ADMIN' | 'RECRUITER') => { const u = await db.user.create({ data: { email: addr, name: addr.split('@')[0], passwordHash: hash } }); await db.membership.create({ data: { userId: u.id, organizationId: o, role } }); return u.id; };
  owner = await mk(email('owner'), org, 'OWNER'); admin = await mk(email('admin'), org, 'ADMIN'); rec = await mk(email('rec'), org, 'RECRUITER');
  otherAdmin = await mk(email('admin', OTHER), other, 'ADMIN');
  outsider = (await db.user.create({ data: { email: email('stranger'), passwordHash: hash } })).id; // has the domain, isn't on the team
  await mk(email('smalladmin', `small-${RUN}.test`), small, 'ADMIN');
  globalThis.fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://api.workos.com', '');
    const auth = (init.headers as Record<string, string>)?.Authorization ?? '';
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init.body ? JSON.parse(String(init.body)) : null;
    workos.calls.push({ method: init.method ?? 'GET', path, body, auth });
    const ok = (o: object, status = 200) => new Response(JSON.stringify(o), { status });
    if (path === '/sso/token') {
      const who = body.client_id === 'client_test' && body.client_secret === 'sk_test' && body.grant_type === 'authorization_code' ? workos.codes[body.code] : undefined;
      return who ? ok({ access_token: 'x', profile: { id: 'prof', email: who.email, organization_id: who.organization_id, connection_id: 'conn_1' } }) : ok({ error: 'invalid_grant', error_description: 'The code is invalid.' }, 400);
    }
    if (auth !== 'Bearer sk_test') return ok({ message: 'Unauthorized' }, 401);
    if (path === '/organizations' && init.method === 'POST') { const id = `org_${Object.keys(workos.orgs).length + 1}`; workos.orgs[id] = { name: body.name, domains: body.domain_data.map((d: { domain: string }) => d.domain) }; return ok({ id }, 201); }
    const o = path.match(/^\/organizations\/(org_\d+)$/);
    if (o && init.method === 'PUT') { workos.orgs[o[1]].domains = body.domain_data.map((d: { domain: string }) => d.domain); return ok({ id: o[1] }); }
    if (o && init.method === 'DELETE') { delete workos.orgs[o[1]]; return ok({}); }
    if (path === '/portal/generate_link') return ok({ link: `https://setup.workos.com/portal/${body.organization}?intent=${body.intent}` });
    if (path.startsWith('/connections?organization_id=')) return ok({ data: [{ id: 'conn_1', state: workos.active ? 'active' : 'draft', connection_type: 'OktaSAML' }] });
    return ok({ message: 'unexpected' }, 404);
  }) as never;
});
beforeEach(() => { process.env.WORKOS_API_KEY = 'sk_test'; process.env.WORKOS_CLIENT_ID = 'client_test'; process.env.APP_URL = 'http://localhost:3000'; });
afterAll(async () => {
  globalThis.fetch = realFetch;
  delete process.env.WORKOS_API_KEY; delete process.env.WORKOS_CLIENT_ID;
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { contains: RUN } } });
  await db.$disconnect();
});

describe('single sign-on setup (Enterprise)', () => {
  it('is Enterprise-only and admin-only', async () => {
    as(rec);
    expect((await STATUS()).status).toBe(403);
    const s = await db.membership.findFirstOrThrow({ where: { organizationId: small } });
    as(s.userId, small);
    expect((await STATUS()).status).toBe(402);
    as(admin);
    expect((await json(await STATUS())).body).toEqual({ state: 'none' });
    delete process.env.WORKOS_API_KEY;
    expect((await json(await STATUS())).body).toEqual({ state: 'off' });
  });

  it('only takes the company’s own domains', async () => {
    await expect(checkDomains(org, [])).rejects.toThrow(/Add your company’s email domain/);
    await expect(checkDomains(org, ['gmail.com'])).rejects.toThrow(/public email service/);
    await expect(checkDomains(org, ['not a domain'])).rejects.toThrow(/isn’t a domain/);
    await expect(checkDomains(org, [OTHER])).rejects.toThrow(/Nobody on your team has an @/);
    expect(await checkDomains(org, [` @${D.toUpperCase()} `, D])).toEqual([D]);
  });

  it('creates the WorkOS organization, then hands IT a setup link', async () => {
    as(admin);
    expect((await json(await SETUP(req('POST', { domains: [D] })))).body).toEqual({ domains: [D] });
    expect(workos.orgs.org_1).toEqual({ name: 'acme Co', domains: [D] });
    expect((await json(await STATUS())).body).toEqual({ state: 'draft', domains: [D], connectionType: null, required: false });
    const p = await json(await PORTAL());
    expect(p.body.link).toBe('https://setup.workos.com/portal/org_1?intent=sso');
    expect(workos.calls.find((c) => c.path === '/portal/generate_link')!.body).toMatchObject({ return_url: 'http://localhost:3000/app/settings?sso=back#sso' });
    // Another company can't claim the same domain.
    as(otherAdmin, other);
    await db.membership.create({ data: { userId: rec, organizationId: other, role: 'RECRUITER' } }); // someone there has an @acme address too
    expect((await json(await SETUP(req('POST', { domains: [D] })))).body.error).toMatch(/already used for single sign-on by another company/);
    await db.membership.deleteMany({ where: { userId: rec, organizationId: other } });
  });

  it('can’t be required or used until IT finishes the connection', async () => {
    as(admin);
    expect((await json(await REQUIRE(req('PATCH', { required: true })))).body.error).toMatch(/Finish connecting your identity provider first/);
    expect(await ssoSignIn(email('rec'))).toEqual({ error: expect.stringMatching(/doesn’t sign in with single sign-on/) });
    workos.active = true;
    expect((await json(await REFRESH())).body).toEqual({ state: 'active' });
    expect((await json(await STATUS())).body).toMatchObject({ state: 'active', connectionType: 'OktaSAML' });
  });
});

describe('signing in with single sign-on', () => {
  it('signs in a team member through their identity provider', async () => {
    const r = await ssoSignIn(email('rec'));
    expect(r.user).toMatchObject({ email: email('rec'), orgId: org, role: 'RECRUITER', via: 'sso' });
    const start = workos.calls.filter((c) => c.path === '/sso/token').at(-1)!;
    expect(start.body).toMatchObject({ client_id: 'client_test', client_secret: 'sk_test', grant_type: 'authorization_code' });
    // The ticket works once.
    expect(await provider('sso')({ ticket: r.ticket! }, { headers: {} })).toBeNull();
    expect(await db.auditLog.count({ where: { organizationId: org, action: 'auth.login', summary: { contains: 'single sign-on' } } })).toBe(1);
  });

  it('only lets in people already on the team, on the company’s own domains', async () => {
    expect((await ssoSignIn(email('stranger'))).error).toMatch(/no Preciops account for .* at this company yet/);
    expect((await ssoSignIn(email('newhire'))).error).toMatch(/no Preciops account/);
    // The identity provider vouching for an address outside the company's domains isn't accepted.
    expect((await ssoSignIn(email('rec'), email('admin', OTHER))).error).toMatch(/isn’t on your company’s single sign-on domains/);
    // A tampered state, or a profile from another WorkOS organization, is refused.
    const s = await json(await START(req('POST', { email: email('rec') })));
    const u = new URL(s.body.url);
    workos.codes.forged = { email: email('rec'), organization_id: 'org_999' };
    const back = await CALLBACK(new Request(`http://x/cb?code=forged&state=${encodeURIComponent(u.searchParams.get('state')!)}`));
    expect(decodeURIComponent(back.headers.get('location')!)).toMatch(/isn’t set up for that company anymore/);
    const bad = await CALLBACK(new Request(`http://x/cb?code=forged&state=tampered.sig`));
    expect(decodeURIComponent(bad.headers.get('location')!)).toMatch(/sign-in link expired/);
    expect(await provider('sso')({ ticket: 'made.up' }, { headers: {} })).toBeNull();
  });

  it('counts as two-step sign-in where the company requires it', async () => {
    await db.organization.update({ where: { id: org }, data: { requireTwoStep: true } });
    as(rec, org);
    expect((await JOBS(req('GET'))).status).toBe(403); // password session without two-step
    as(rec, org, 'sso');
    expect((await JOBS(req('GET'))).status).toBe(200);
    await db.organization.update({ where: { id: org }, data: { requireTwoStep: false } });
  });

  it('when required, passwords stop working except for owners', async () => {
    as(admin);
    expect((await REQUIRE(req('PATCH', { required: true }))).status).toBe(200);
    await expect(password(email('rec'))).rejects.toThrow(SSO_REQUIRED);
    await expect(password(email('admin'))).rejects.toThrow(SSO_REQUIRED);
    expect(await password(email('owner'))).toMatchObject({ email: email('owner'), orgId: org });
    expect((await password(email('admin', OTHER)))).toMatchObject({ orgId: other }); // other companies unaffected
    expect(await db.auditLog.count({ where: { organizationId: org, action: 'settings.sso' } })).toBe(2);
  });

  it('switching off at the identity provider, or here, puts passwords back', async () => {
    workos.active = false;
    as(admin);
    expect((await json(await REFRESH())).body).toEqual({ state: 'draft' });
    expect(await db.organization.findUniqueOrThrow({ where: { id: org } })).toMatchObject({ ssoRequired: false });
    expect(await password(email('rec'))).toMatchObject({ orgId: org });
    workos.active = true;
    expect((await TURN_OFF()).status).toBe(200);
    expect(workos.orgs.org_1).toBeUndefined();
    expect(await db.ssoConnection.count({ where: { organizationId: org } })).toBe(0);
    expect((await ssoSignIn(email('rec'))).error).toMatch(/doesn’t sign in with single sign-on/);
  });
});
