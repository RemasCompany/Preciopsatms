import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string; issuedAt?: number } } }));
const out = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; text: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: { to: string; subject: string; text: string }) => { out.emails.push(o); return { id: 'e' }; }) }));

import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { POST as FORGOT } from '@/app/api/auth/forgot/route';
import { GET as RESET_CHECK, POST as RESET } from '@/app/api/auth/reset/route';
import { POST as VERIFY } from '@/app/api/auth/verify/route';
import { POST as RESEND } from '@/app/api/auth/verify/resend/route';
import { requireApiContext } from '@/lib/tenant';

const RUN = `ac${Date.now()}`;
let org: string, user: string;
const email = `pat@${RUN}.test`;
const post = (body: object, ip = '1.1.1.1') => new Request('http://x', { method: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify(body) });
const linkFrom = (kind: 'reset' | 'verify') => out.emails.at(-1)!.text.match(new RegExp(`/${kind}/([\\w-]+)`))![1];

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Acct Staffing', slug: `acct-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  user = (await db.user.create({ data: { email, name: 'Pat Lee', passwordHash: await bcrypt.hash('old-password-1', 4) } })).id;
  await db.membership.create({ data: { userId: user, organizationId: org, role: 'OWNER' } });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('forgot password', () => {
  it('answers the same whether or not the account exists', async () => {
    out.emails = [];
    const a = await (await FORGOT(post({ email: `nobody@${RUN}.test` }))).json();
    const b = await (await FORGOT(post({ email: email.toUpperCase() }))).json();
    expect(a).toEqual(b);
    expect(out.emails.map((e) => e.to)).toEqual([email]);
    expect((await (await FORGOT(post({ email: 'nope' }))).json()).error).toBe('Enter your email address.');
  });

  it('resets once, signs out older sessions and confirms the email', async () => {
    const tok = linkFrom('reset');
    expect(await (await RESET_CHECK(new Request(`http://x?token=${tok}`))).json()).toEqual({ ok: true, email });
    expect((await (await RESET(post({ token: tok, password: 'short' }))).json()).error).toBe('Use at least 10 characters.');
    const oldSession = Math.floor(Date.now() / 1000) - 60;
    session.current = { user: { id: user, orgId: org, issuedAt: oldSession } };
    expect((await requireApiContext({})).user.id).toBe(user);
    await new Promise((r) => setTimeout(r, 1100));
    expect((await RESET(post({ token: tok, password: 'brand-new-password' }))).status).toBe(200);
    const u = await db.user.findUnique({ where: { id: user } });
    expect(await bcrypt.compare('brand-new-password', u!.passwordHash)).toBe(true);
    expect(u!.emailVerifiedAt).not.toBeNull();
    await expect(requireApiContext({})).rejects.toMatchObject({ status: 401 });
    session.current = { user: { id: user, orgId: org, issuedAt: Math.floor(Date.now() / 1000) } };
    expect((await requireApiContext({})).user.id).toBe(user);
    expect((await RESET(post({ token: tok, password: 'another-password' }))).status).toBe(404); // used
  });

  it('only the newest link works, and links expire', async () => {
    await FORGOT(post({ email }, '2.2.2.2'));
    const first = linkFrom('reset');
    await FORGOT(post({ email }, '2.2.2.2'));
    const second = linkFrom('reset');
    expect((await RESET_CHECK(new Request(`http://x?token=${first}`))).status).toBe(404);
    await db.authToken.updateMany({ where: { userId: user, kind: 'reset', usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await (await RESET(post({ token: second, password: 'expired-password' }))).json()).error).toBe('This reset link has expired or was already used. Ask for a new one.');
  });

  it('rate-limits one address', async () => {
    const r = await FORGOT(post({ email }, '3.3.3.3'));
    expect(r.status).toBe(429); // three already sent above within the hour
  });
});

describe('email verification', () => {
  it('resends to the signed-in user and confirms once', async () => {
    await db.user.update({ where: { id: user }, data: { emailVerifiedAt: null } });
    session.current = { user: { id: user, orgId: org, issuedAt: Math.floor(Date.now() / 1000) } };
    expect((await RESEND()).status).toBe(200);
    expect(out.emails.at(-1)!.subject).toBe('Confirm your email for Preciops');
    const tok = linkFrom('verify');
    expect(await (await VERIFY(post({ token: tok }))).json()).toEqual({ ok: true, email });
    expect((await db.user.findUnique({ where: { id: user } }))!.emailVerifiedAt).not.toBeNull();
    expect((await VERIFY(post({ token: tok }))).status).toBe(404);
    expect(await (await RESEND()).json()).toEqual({ ok: true, already: true });
    session.current = null;
    expect((await RESEND()).status).toBe(401);
  });
});
