import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string; issuedAt?: number; via?: 'sso' } } }));
const out = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; text: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: { to: string; subject: string; text: string }) => { out.emails.push(o); return { id: 'e' }; }) }));

import { db } from '@/lib/db';
import { requireApiContext } from '@/lib/tenant';
import { accounts, inFilter, isPlatformEmail, platformAdmin, standing } from '@/lib/platform';
import { GET as CSV } from '@/app/api/platform/accounts/route';
import { noticeDue, runTrialLifecycle } from '@/lib/trials';

const RUN = `pf${Date.now()}`;
const DAY = 864e5;
const at = (days: number) => new Date(Date.now() + days * DAY);
let admin: string, outsider: string, ownOrg: string;
const orgs: Record<string, string> = {};
const owners: Record<string, string> = {};

async function company(key: string, data: Record<string, unknown>) {
  const o = await db.organization.create({ data: { name: `${key} Co ${RUN}`, slug: `${key}-${RUN}`, ...data } as never });
  const u = await db.user.create({ data: { email: `${key}@${RUN}.test`, name: `${key} Owner`, passwordHash: 'x' } });
  await db.membership.create({ data: { userId: u.id, organizationId: o.id, role: 'OWNER' } });
  orgs[key] = o.id; owners[key] = u.id;
}

beforeAll(async () => {
  ownOrg = (await db.organization.create({ data: { name: `Remas ${RUN}`, slug: `remas-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  admin = (await db.user.create({ data: { email: `ops.${RUN}@remascompany.com`, name: 'Ops', passwordHash: 'x' } })).id;
  outsider = (await db.user.create({ data: { email: `someone@${RUN}.test`, name: 'Someone', passwordHash: 'x', emailVerifiedAt: new Date(), totpEnabledAt: new Date() } })).id;
  await db.membership.createMany({ data: [{ userId: admin, organizationId: ownOrg, role: 'OWNER' }, { userId: outsider, organizationId: ownOrg, role: 'ADMIN' }] });
  await company('soon', { subscriptionStatus: 'trialing', trialEndsAt: at(1.5) });
  await company('later', { subscriptionStatus: 'trialing', trialEndsAt: at(10) });
  await company('over', { subscriptionStatus: 'trialing', trialEndsAt: at(-0.5) });
  await company('card', { subscriptionStatus: 'trialing', trialEndsAt: at(-0.5), stripeSubscriptionId: `sub_${RUN}` });
  await company('free', { subscriptionStatus: 'active', complimentary: true, plan: 'enterprise' });
  await company('paid', { subscriptionStatus: 'active', stripeSubscriptionId: `sub2_${RUN}`, name: `=HYPERLINK("x") ${RUN}` });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { OR: [{ email: { endsWith: `@${RUN}.test` } }, { email: `ops.${RUN}@remascompany.com` }] } });
  await db.$disconnect();
});

describe('who can open the platform console', () => {
  it('anyone at remascompany.com, nobody else', () => {
    for (const e of ['owner@remascompany.com', 'Owner@RemasCompany.com', 'ops@remascompany.com']) expect(isPlatformEmail(e), e).toBe(true);
    for (const e of ['owner@remascompany.com.evil.io', 'x@notremascompany.com', 'remascompany.com', '', null]) expect(isPlatformEmail(e), String(e)).toBe(false);
  });
  it('a platform email still needs a confirmed email and two-step sign-in; everyone else gets a 404', async () => {
    session.current = { user: { id: outsider, orgId: ownOrg } };
    expect(await platformAdmin()).toBeNull();
    expect((await CSV(new Request('http://x/api/platform/accounts'))).status).toBe(404);
    session.current = { user: { id: admin, orgId: ownOrg } };
    expect(await platformAdmin()).toMatchObject({ setup: [expect.stringContaining('Confirm your email'), expect.stringContaining('two-step')] });
    expect((await CSV(new Request('http://x/api/platform/accounts'))).status).toBe(403);
    session.current = { user: { id: admin, orgId: ownOrg, via: 'sso' } };
    expect(await platformAdmin()).toMatchObject({ setup: [expect.stringContaining('Confirm your email')] }); // SSO counts as the second step
    await db.user.update({ where: { id: admin }, data: { emailVerifiedAt: new Date(), totpEnabledAt: new Date() } });
    session.current = { user: { id: admin, orgId: ownOrg } };
    expect(await platformAdmin()).toMatchObject({ email: `ops.${RUN}@remascompany.com` });
    session.current = null;
    expect(await platformAdmin()).toBeNull();
  });
});

describe('accounts list', () => {
  it('shows every company with where it stands, and filters', async () => {
    const rows = (await accounts({ q: RUN })).filter((r) => r.slug.endsWith(RUN));
    const by = (k: string) => rows.find((r) => r.id === orgs[k])!;
    expect(by('soon')).toMatchObject({ standing: 'trial', standingLabel: 'Trial · 2 days left', users: 1, owner: { email: `soon@${RUN}.test` } });
    expect(by('free').standingLabel).toBe('Complimentary');
    expect(by('paid').standing).toBe('paying');
    const ending = rows.filter((r) => inFilter(r, 'ending')).map((r) => r.id);
    expect(ending).toContain(orgs.soon);
    expect(ending).not.toContain(orgs.later);
    expect((await accounts({ q: `soon@${RUN}` })).map((r) => r.id)).toEqual([orgs.soon]); // search by owner email
    expect(standing({ subscriptionStatus: 'trial_expired', trialEndsAt: null, complimentary: false }).label).toBe('Trial ended');
  });
  it('exports CSV for admins, with spreadsheet formulas neutralized', async () => {
    session.current = { user: { id: admin, orgId: ownOrg } };
    const r = await CSV(new Request(`http://x/api/platform/accounts?q=${RUN}`));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/csv');
    const text = await r.text();
    expect(text.split('\n')[0]).toContain('Company,Type,Industry,Plan,Standing');
    expect(text).toContain(`"'=HYPERLINK(""x"") ${RUN}"`);
  });
});

describe('trial ending', () => {
  it('picks the right email: 3 days, 1 day, then ended, never twice and never a stale one', () => {
    expect(noticeDue({ trialEndsAt: at(2.5), trialNotice: -1 })).toBe(0);
    expect(noticeDue({ trialEndsAt: at(0.5), trialNotice: -1 })).toBe(1); // skip straight to the 1-day email
    expect(noticeDue({ trialEndsAt: at(0.5), trialNotice: 1 })).toBeNull();
    expect(noticeDue({ trialEndsAt: at(5), trialNotice: -1 })).toBeNull();
    expect(noticeDue({ trialEndsAt: at(-1), trialNotice: 1 })).toBe(2);
    expect(noticeDue({ trialEndsAt: at(-1), trialNotice: 2 })).toBeNull();
  });
  it('emails owners before the end, makes expired trials read-only, and leaves card trials and free companies alone', async () => {
    out.emails = [];
    await runTrialLifecycle();
    const to = (k: string) => out.emails.filter((e) => e.to === `${k}@${RUN}.test`);
    expect(to('soon').map((e) => e.subject)).toEqual(['2 days left in your Preciops trial']);
    expect(to('soon')[0]).toMatchObject({ replyTo: 'sales@preciopsatms.com' });
    expect(to('soon')[0].text).toContain('sales@preciopsatms.com');
    expect(to('later')).toHaveLength(0);
    expect(to('over').map((e) => e.subject)).toEqual([`Your Preciops trial for over Co ${RUN} has ended`]);
    expect(to('card')).toHaveLength(0);
    expect(to('free')).toHaveLength(0);
    const get = (k: string) => db.organization.findUniqueOrThrow({ where: { id: orgs[k] } });
    expect((await get('over')).subscriptionStatus).toBe('trial_expired');
    expect((await get('card')).subscriptionStatus).toBe('trialing'); // Stripe runs card trials
    expect((await get('soon')).subscriptionStatus).toBe('trialing');
    // Read-only now: changes are refused, and the next run doesn't email again.
    session.current = { user: { id: owners.over, orgId: orgs.over } };
    await expect(requireApiContext({ write: true })).rejects.toMatchObject({ status: 402 });
    await expect(requireApiContext({})).resolves.toBeTruthy(); // can still sign in and look
    out.emails = [];
    await runTrialLifecycle();
    expect(out.emails.filter((e) => e.to.endsWith(`@${RUN}.test`))).toHaveLength(0);
    expect(await db.message.count({ where: { organizationId: orgs.over, relatedType: 'trial_notice', status: 'sent' } })).toBe(1);
  });
});
