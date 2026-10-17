import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { authOptions } from '@/lib/auth';
import { base32Decode, base32Encode, codeAt, hashRecovery, otpauthUrl, stepAt, verifyCode, newRecoveryCodes, looksLikeRecovery } from '@/lib/totp';
import { TWO_STEP_INVALID, TWO_STEP_REQUIRED } from '@/lib/two-step';
import { GET as STATUS, POST as BEGIN, PUT as CONFIRM, DELETE as DISABLE } from '@/app/api/account/two-step/route';
import { POST as NEW_CODES } from '@/app/api/account/two-step/recovery/route';
import { PATCH as REQUIRE } from '@/app/api/settings/two-step/route';
import { DELETE as RESET } from '@/app/api/team/members/[id]/two-step/route';
import { GET as JOBS } from '@/app/api/jobs/route';

const RUN = `ts${Date.now()}`;
const PW = 'right-password-1';
let org: string, other: string, owner: string, admin: string, rec: string;
type Authorize = (c: Record<string, string>, r: { headers: Record<string, string> }) => Promise<unknown>;
const authorize = (authOptions.providers[0] as unknown as { options: { authorize: Authorize } }).options.authorize;
let ipN = 0;
const signIn = (email: string, code?: string) => authorize({ email, password: PW, ...(code ? { code } : {}) }, { headers: { 'x-forwarded-for': `10.7.${RUN.length}.${++ipN}` } });
const as = (id: string, o = org) => { session.current = { user: { id, orgId: o } }; };
const req = (method: string, body?: unknown) => new Request('http://x', { method, body: body === undefined ? undefined : JSON.stringify(body) });
const call = async (fn: (r: Request, c: never) => Promise<Response>, method: string, body?: unknown, ctx?: unknown) => {
  const r = await fn(req(method, body), ctx as never); return { status: r.status, body: await r.json() };
};
const email = (who: string) => `${who}@${RUN}.test`;
/** The secret behind the QR code, read back the way an authenticator app would. */
const secretFrom = (url: string) => new URL(url.replace('otpauth://', 'http://')).searchParams.get('secret')!;

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Two Step Co', slug: `a-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  other = (await db.organization.create({ data: { name: 'Other Co', slug: `b-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  const hash = await bcrypt.hash(PW, 4);
  const mk = async (who: string, role: 'OWNER' | 'ADMIN' | 'RECRUITER') => {
    const u = await db.user.create({ data: { email: email(who), name: who, passwordHash: hash } });
    await db.membership.create({ data: { userId: u.id, organizationId: org, role } }); return u.id;
  };
  owner = await mk('owner', 'OWNER'); admin = await mk('admin', 'ADMIN'); rec = await mk('rec', 'RECRUITER');
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('authenticator codes (RFC 6238)', () => {
  // The RFC's SHA-1 test secret is the ASCII bytes "12345678901234567890"; its 8-digit answers end in these 6 digits.
  const rfc = base32Encode(Buffer.from('12345678901234567890'));
  it('matches the RFC test vectors', () => {
    expect(rfc).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(rfc).toString()).toBe('12345678901234567890');
    expect(codeAt(rfc, stepAt(59e3))).toBe('287082');
    expect(codeAt(rfc, stepAt(1111111109e3))).toBe('081804');
    expect(codeAt(rfc, stepAt(1234567890e3))).toBe('005924');
    expect(codeAt(rfc, stepAt(2000000000e3))).toBe('279037');
  });

  it('allows one step of clock drift, and never the same step twice', () => {
    const t = 1111111109e3, now = stepAt(t);
    expect(verifyCode(rfc, '081804', t)).toBe(now);
    expect(verifyCode(rfc, '081 804', t + 30e3)).toBe(now); // a phone half a minute slow
    expect(verifyCode(rfc, '081804', t + 90e3)).toBeNull(); // too old
    expect(verifyCode(rfc, '081804', t, now)).toBeNull(); // already used
    expect(verifyCode(rfc, codeAt(rfc, now + 1), t, now)).toBe(now + 1);
    expect(verifyCode(rfc, '12345', t)).toBeNull();
    expect(verifyCode(rfc, 'abcdef', t)).toBeNull();
  });

  it('makes readable one-time recovery codes and an app link', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) { expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/); expect(c).not.toMatch(/[01ilo]/); expect(looksLikeRecovery(c)).toBe(true); }
    expect(hashRecovery('ABCD-efgh')).toBe(hashRecovery(' abcd efgh '));
    expect(looksLikeRecovery('123456')).toBe(false);
    expect(otpauthUrl('Preciops ATMS', 'a@b.co', 'ABC')).toBe('otpauth://totp/Preciops%20ATMS%3Aa%40b.co?secret=ABC&issuer=Preciops%20ATMS&algorithm=SHA1&digits=6&period=30');
  });
});

describe('two-step sign-in', () => {
  let secret = '', recovery: string[] = [];
  const now = () => codeAt(secret, stepAt(Date.now()));
  const next = () => codeAt(secret, stepAt(Date.now()) + 1); // still accepted, and not yet used

  it('is set up with a QR code and turned on by the first code', async () => {
    as(admin);
    expect((await call(STATUS, 'GET')).body).toEqual({ enabled: false, enabledAt: null, recoveryLeft: 0 });
    const s = await call(BEGIN, 'POST');
    expect(s.body.qr).toMatch(/^data:image\/png;base64,/);
    expect(s.body.url).toContain(encodeURIComponent(email('admin')));
    secret = secretFrom(s.body.url);
    expect(s.body.secret.replace(/ /g, '')).toBe(secret);
    expect(s.body.pending).not.toContain(secret);
    // Not in force until confirmed.
    expect(await signIn(email('admin'))).toMatchObject({ email: email('admin') });
    expect((await call(CONFIRM, 'PUT', { pending: s.body.pending, code: '000000' })).body.error).toMatch(/didn’t match/);
    // Someone else's pending setup is no use.
    as(rec);
    expect((await call(CONFIRM, 'PUT', { pending: s.body.pending, code: now() })).body.error).toMatch(/expired/);
    as(admin);
    const ok = await call(CONFIRM, 'PUT', { pending: s.body.pending, code: now() });
    expect(ok.status).toBe(200);
    recovery = ok.body.recoveryCodes;
    expect(recovery).toHaveLength(10);
    expect((await db.user.findUniqueOrThrow({ where: { id: admin } })).recoveryCodes).not.toContain(recovery[0]); // hashed
    expect((await call(STATUS, 'GET')).body).toMatchObject({ enabled: true, recoveryLeft: 10 });
    // The secret isn't stored in the clear.
    expect((await db.user.findUniqueOrThrow({ where: { id: admin } })).totpSecret).toMatch(/^v1\./);
    expect(await db.auditLog.count({ where: { organizationId: org, action: 'auth.two_step_on' } })).toBe(1);
  });

  it('asks for the code after the right password, and rejects a wrong or reused one', async () => {
    await expect(signIn(email('admin'))).rejects.toThrow(TWO_STEP_REQUIRED);
    await expect(signIn(email('admin'), '000000')).rejects.toThrow(TWO_STEP_INVALID);
    expect(await db.auditLog.count({ where: { organizationId: org, action: 'auth.two_step_failed' } })).toBe(1);
    const c = next();
    expect(await signIn(email('admin'), c)).toMatchObject({ email: email('admin'), orgId: org });
    await expect(signIn(email('admin'), c)).rejects.toThrow(TWO_STEP_INVALID); // replayed
    // A wrong password never gets as far as asking for the code.
    expect(await authorize({ email: email('admin'), password: 'nope' }, { headers: { 'x-forwarded-for': '10.8.0.1' } })).toBeNull();
  });

  it('takes each recovery code once', async () => {
    expect(await signIn(email('admin'), recovery[0].toUpperCase())).toMatchObject({ email: email('admin') });
    await expect(signIn(email('admin'), recovery[0])).rejects.toThrow(TWO_STEP_INVALID);
    expect((await call(STATUS, 'GET')).body.recoveryLeft).toBe(9);
    expect(await db.auditLog.findFirst({ where: { organizationId: org, action: 'auth.recovery_used' } })).toMatchObject({ summary: expect.stringContaining('9 left') });
    // New codes replace the old ones.
    expect((await call(NEW_CODES, 'POST', { code: '111111' })).status).toBe(400);
    const fresh = await call(NEW_CODES, 'POST', { code: recovery[1] });
    expect(fresh.body.recoveryCodes).toHaveLength(10);
    await expect(signIn(email('admin'), recovery[2])).rejects.toThrow(TWO_STEP_INVALID);
    recovery = fresh.body.recoveryCodes;
  });

  it('moves to a new phone with a code from the old one', async () => {
    const s = await call(BEGIN, 'POST');
    const fresh = secretFrom(s.body.url);
    const newCode = codeAt(fresh, stepAt(Date.now()));
    expect((await call(CONFIRM, 'PUT', { pending: s.body.pending, code: newCode })).body.error).toMatch(/old phone/);
    expect((await call(CONFIRM, 'PUT', { pending: s.body.pending, code: newCode, proof: '000000' })).body.error).toMatch(/didn’t work/);
    const moved = await call(CONFIRM, 'PUT', { pending: s.body.pending, code: newCode, proof: recovery[3] }); // (this step's app code was used to sign in above)
    expect(moved.status).toBe(200);
    recovery = moved.body.recoveryCodes;
    secret = fresh;
    // The old phone's codes stop working; the new one's work.
    await expect(signIn(email('admin'), codeAt(fresh, stepAt(Date.now()) - 5))).rejects.toThrow(TWO_STEP_INVALID);
    expect(await db.auditLog.count({ where: { organizationId: org, action: 'auth.two_step_on', summary: { contains: 'new phone' } } })).toBe(1);
  });

  it('can be required for the team: others must set it up before using the app', async () => {
    as(owner);
    expect((await call(REQUIRE, 'PATCH', { required: true })).body.error).toMatch(/for yourself first/);
    as(admin);
    expect((await call(REQUIRE, 'PATCH', { required: true })).body).toEqual({ ok: true, missing: 2 });
    as(rec);
    const blocked = await JOBS(req('GET'));
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error).toMatch(/requires two-step sign-in/);
    expect((await call(STATUS, 'GET')).status).toBe(200); // setup still works
    as(admin);
    expect((await JOBS(req('GET'))).status).toBe(200);
    // And once it's required, it can't be turned off.
    expect((await call(DISABLE, 'DELETE', { code: recovery[0] })).body.error).toMatch(/requires two-step sign-in/);
    expect(await db.auditLog.count({ where: { organizationId: org, action: 'settings.two_step' } })).toBe(1);
  });

  it('can be reset by an admin for a teammate who lost their phone', async () => {
    // The recruiter sets it up…
    as(rec);
    const s = await call(BEGIN, 'POST');
    const recSecret = secretFrom(s.body.url);
    await call(CONFIRM, 'PUT', { pending: s.body.pending, code: codeAt(recSecret, stepAt(Date.now())) });
    const recMember = await db.membership.findFirstOrThrow({ where: { userId: rec, organizationId: org } });
    const ownerMember = await db.membership.findFirstOrThrow({ where: { userId: owner, organizationId: org } });
    const ctx = (id: string) => ({ params: { id } });
    // …a recruiter can't reset anyone; an admin can't reset an owner or someone who has none.
    expect((await call(RESET, 'DELETE', undefined, ctx(recMember.id))).status).toBe(403);
    as(admin);
    expect((await call(RESET, 'DELETE', undefined, ctx(ownerMember.id))).body.error).toMatch(/Only an owner/);
    // Someone who also belongs to another company can't be reset from here.
    await db.membership.create({ data: { userId: rec, organizationId: other, role: 'RECRUITER' } });
    expect((await call(RESET, 'DELETE', undefined, ctx(recMember.id))).body.error).toMatch(/another company/);
    await db.membership.deleteMany({ where: { userId: rec, organizationId: other } });
    expect((await call(RESET, 'DELETE', undefined, ctx(recMember.id))).status).toBe(200);
    expect(await db.user.findUniqueOrThrow({ where: { id: rec } })).toMatchObject({ totpEnabledAt: null, totpSecret: null, recoveryCodes: [] });
    expect(await signIn(email('rec'))).toMatchObject({ email: email('rec') }); // password only again
    // An admin in another company can't reach this team's members at all.
    const outsider = await db.user.create({ data: { email: email('out'), passwordHash: 'x', totpEnabledAt: new Date() } });
    await db.membership.create({ data: { userId: outsider.id, organizationId: other, role: 'OWNER' } });
    as(outsider.id, other);
    expect((await call(RESET, 'DELETE', undefined, ctx(recMember.id))).status).toBe(404);
  });

  it('turns off with a code where it isn’t required, and limits guesses', async () => {
    as(admin);
    await call(REQUIRE, 'PATCH', { required: false });
    let last = 0;
    for (let i = 0; i < 10 && last !== 429; i++) last = (await call(DISABLE, 'DELETE', { code: '000000' })).status;
    expect(last).toBe(429);
    as(owner);
    const s = await call(BEGIN, 'POST');
    const ownerSecret = secretFrom(s.body.url);
    await call(CONFIRM, 'PUT', { pending: s.body.pending, code: codeAt(ownerSecret, stepAt(Date.now())) });
    expect((await call(DISABLE, 'DELETE', { code: codeAt(ownerSecret, stepAt(Date.now()) + 1) })).status).toBe(200);
    expect((await call(STATUS, 'GET')).body.enabled).toBe(false);
    expect(await db.auditLog.count({ where: { organizationId: org, action: 'auth.two_step_off' } })).toBe(1);
  });
});
