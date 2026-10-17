import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { renderToStaticMarkup } from 'react-dom/server';
import { db } from '@/lib/db';
import { authOptions, LOGIN_LIMITS, TOO_MANY } from '@/lib/auth';
import { GET as SECURITY_TXT } from '@/app/.well-known/security.txt/route';
import SecurityPage from '@/app/(marketing)/security/page';
// @ts-expect-error -- the Next config is plain JavaScript
import nextConfig from '../next.config.mjs';

const RUN = `sec${Date.now()}`;
const email = `owner@${RUN}.test`;
type Authorize = (c: Record<string, string>, r: { headers: Record<string, string> }) => Promise<unknown>;
const authorize = (authOptions.providers[0] as unknown as { options: { authorize: Authorize } }).options.authorize;
const attempt = (password: string, ip: string, who = email) => authorize({ email: who, password }, { headers: { 'x-forwarded-for': ip } });

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: 'Sec Co', slug: `s-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } });
  const u = await db.user.create({ data: { email, name: 'Owner', passwordHash: await bcrypt.hash('right-password-1', 4) } });
  await db.membership.create({ data: { userId: u.id, organizationId: org.id, role: 'OWNER' } });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('sign-in throttling', () => {
  it('stops password guessing for one email, even with the right password', async () => {
    expect(await attempt('right-password-1', '10.0.0.1')).toMatchObject({ email });
    for (let i = 1; i < LOGIN_LIMITS.email; i++) expect(await attempt('wrong', `10.0.1.${i}`)).toBeNull();
    await expect(attempt('right-password-1', '10.0.2.1')).rejects.toThrow(TOO_MANY);
    expect(await db.auditLog.count({ where: { action: 'auth.login_failed', summary: { contains: email } } })).toBe(LOGIN_LIMITS.email - 1);
  });

  it('stops one address trying many emails', async () => {
    for (let i = 0; i < LOGIN_LIMITS.ip; i++) await attempt('x', '10.9.9.9', `nobody${i}@${RUN}.test`);
    await expect(attempt('x', '10.9.9.9', `another@${RUN}.test`)).rejects.toThrow(TOO_MANY);
  });
});

describe('security headers', () => {
  it('sends baseline headers everywhere and blocks framing of private pages', async () => {
    const rules = (await nextConfig.headers()) as { source: string; headers: { key: string; value: string }[] }[];
    const all = rules.find((r) => r.source === '/:path*')!.headers.map((h) => h.key);
    expect(all).toEqual(['X-Content-Type-Options', 'Referrer-Policy', 'Strict-Transport-Security', 'Permissions-Policy']);
    const framed = rules.filter((r) => r.headers.some((h) => h.key === 'X-Frame-Options')).map((r) => r.source);
    expect(framed).toEqual(expect.arrayContaining(['/app/:path*', '/login', '/client/:path*', '/shifts/:path*', '/sign/:path*']));
    // The careers page and its embed stay frameable / readable by customers' sites.
    expect(framed.some((s) => s.startsWith('/careers'))).toBe(false);
  });
});

describe('security page', () => {
  it('says what is and isn’t in place, and where to report problems', async () => {
    const html = renderToStaticMarkup(SecurityPage());
    expect(html).toContain('Passwords are stored only as bcrypt hashes');
    expect(html).toContain('Not in place yet');
    expect(html).toContain('Single sign-on (SAML or OIDC).');
    expect(html).toContain('Two-step sign-in with an authenticator app');
    expect(html).toContain('mailto:security@preciopsatms.com');
    const txt = await (await SECURITY_TXT()).text();
    expect(txt).toMatch(/^Contact: mailto:security@preciopsatms\.com\nExpires: \d{4}-\d{2}-\d{2}T/);
    expect(txt).toContain('Policy: ');
  });
});
