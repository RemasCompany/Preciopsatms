import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const out = vi.hoisted(() => ({ emails: [] as { to: string; subject: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: { to: string; subject: string }) => { out.emails.push(o); return { id: 'e' }; }) }));

import { db } from '@/lib/db';
import { emailStatus } from '@/lib/email-status';
import { POST as TEST_EMAIL } from '@/app/api/platform/test-email/route';

const RUN = `es${Date.now()}`;
let org: string, admin: string, customer: string;
beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Remas', slug: `r-${RUN}`, subscriptionStatus: 'active' } })).id;
  admin = (await db.user.create({ data: { email: `ops.${RUN}@remascompany.com`, name: 'Ops', passwordHash: 'x', emailVerifiedAt: new Date(), totpEnabledAt: new Date() } })).id;
  customer = (await db.user.create({ data: { email: `c@${RUN}.test`, name: 'C', passwordHash: 'x', emailVerifiedAt: new Date(), totpEnabledAt: new Date() } })).id;
  await db.membership.createMany({ data: [{ userId: admin, organizationId: org, role: 'OWNER' }, { userId: customer, organizationId: org, role: 'ADMIN' }] });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { in: [`ops.${RUN}@remascompany.com`, `c@${RUN}.test`] } } });
});

describe('email status', () => {
  it('says plainly when the live site sends no email, and never shows the key', () => {
    expect(emailStatus({})).toMatchObject({ ok: false });
    expect(emailStatus({}).summary).toContain('sends no email at all');
    expect(emailStatus({ RESEND_API_KEY: 'sk_live_x', EMAIL_FROM: 'a@b.c' }).summary).toContain('re_');
    expect(emailStatus({ RESEND_API_KEY: 're_secret123' }).summary).toContain('EMAIL_FROM');
    const ok = emailStatus({ RESEND_API_KEY: 're_secret123', EMAIL_FROM: 'Preciops <notifications@mail.preciopsatms.com>' });
    expect(ok).toMatchObject({ ok: true, from: 'notifications@mail.preciopsatms.com' });
    expect(JSON.stringify(ok)).not.toContain('re_secret123');
  });
  it('the test email goes to the platform admin only', async () => {
    process.env.RESEND_API_KEY = 're_test_key'; process.env.EMAIL_FROM = 'Preciops <notifications@mail.preciopsatms.com>';
    session.current = { user: { id: customer, orgId: org } };
    expect((await TEST_EMAIL()).status).toBe(404);
    session.current = { user: { id: admin, orgId: org } };
    out.emails = [];
    expect((await TEST_EMAIL()).status).toBe(200);
    expect(out.emails).toEqual([expect.objectContaining({ to: `ops.${RUN}@remascompany.com`, subject: 'Preciops test email' })]);
    delete process.env.RESEND_API_KEY;
    expect((await TEST_EMAIL()).status).toBe(503);
  });
});
