import { afterAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ id: 'e' })) }));

import { db } from '@/lib/db';
import { POST as SIGNUP } from '@/app/api/signup/route';
import { POST as CHECKOUT } from '@/app/api/stripe/checkout/route';
import { POST as VERIFY } from '@/app/api/auth/verify/route';
import { issueToken } from '@/lib/account';
import { syncSubscription } from '@/lib/stripe';
import { complimentaryFor, normalizeCompany, COMPLIMENTARY } from '@/lib/complimentary';
import { applyComplimentary } from '../scripts/complimentary.mjs';
import type Stripe from 'stripe';

const RUN = `cp${Date.now()}`;
// Owners at Eye Tek's own domain use a unique address per run, so tests never collide (no email is sent: it's mocked).
const addr = (who: string) => (who.startsWith('eyetek') ? `${who}.${RUN}@eyeteksecurity.com` : `${who}@${RUN}.test`);
const signup = (company: string, who: string) => SIGNUP(new Request('http://x', { method: 'POST', body: JSON.stringify({ company, name: 'Pat Owner', email: addr(who), password: 'long-enough-1' }) }));
const orgOf = async (who: string) => (await db.membership.findFirstOrThrow({ where: { user: { email: addr(who) } }, include: { organization: true } })).organization;
const verify = async (who: string) => { const u = await db.user.findUniqueOrThrow({ where: { email: addr(who) } }); const token = await issueToken(u.id, 'verify'); return (await VERIFY(new Request('http://x', { method: 'POST', body: JSON.stringify({ token }) }))).json(); };
const mine = { OR: [{ email: { endsWith: `@${RUN}.test` } }, { email: { endsWith: `.${RUN}@eyeteksecurity.com` } }] };

afterAll(async () => {
  const users = await db.user.findMany({ where: mine, select: { id: true } });
  await db.organization.deleteMany({ where: { OR: [{ members: { some: { userId: { in: users.map((u) => u.id) } } } }, { slug: { endsWith: RUN } }] } });
  await db.user.deleteMany({ where: mine });
  await db.$disconnect();
});

describe('complimentary plans', () => {
  it('Eye Tek is on the list for Enterprise: any company whose owner has a confirmed @eyeteksecurity.com email, whatever it’s called', () => {
    expect(COMPLIMENTARY.find((c) => c.name === 'Eye Tek Security Services, LLC')).toMatchObject({ plan: 'enterprise', domains: ['eyeteksecurity.com'] });
    for (const n of ['Eye Tek Security Services, LLC', 'EyeTek Security', 'Eye Tek Security Services Group', 'ETSS'])
      expect(complimentaryFor(n, 'owner@eyeteksecurity.com')?.plan, n).toBe('enterprise');
    expect(complimentaryFor('x', 'Owner@EyeTekSecurity.com')?.plan).toBe('enterprise');
    expect(complimentaryFor('x', 'owner@mail.eyeteksecurity.com')?.plan).toBe('enterprise');
    expect(complimentaryFor('Eye Tek Security Services, LLC', 'owner@eyeteksecurity.com', false)).toBeNull(); // not confirmed yet
    for (const e of ['owner@gmail.com', 'owner@eyeteksecurity.com.evil.io', 'owner@noteyeteksecurity.com', null]) expect(complimentaryFor('Eye Tek Security Services, LLC', e), String(e)).toBeNull();
    expect(normalizeCompany('A & B, Inc.')).toBe('aandb');
  });

  it('an Eye Tek owner gets free Enterprise the moment they confirm their email: active, no trial, nothing to pay', async () => {
    expect((await signup('EyeTek Security', 'eyetek')).status).toBe(200);
    expect(await orgOf('eyetek')).toMatchObject({ subscriptionStatus: 'trialing', complimentary: false }); // anyone could type that address
    expect(await verify('eyetek')).toMatchObject({ ok: true, complimentary: true });
    const o = await orgOf('eyetek');
    expect(o).toMatchObject({ plan: 'enterprise', subscriptionStatus: 'active', trialEndsAt: null, complimentary: true, stripeCustomerId: null });
    const user = await db.user.findUniqueOrThrow({ where: { email: addr('eyetek') } });
    session.current = { user: { id: user.id, orgId: o.id } };
    const r = await CHECKOUT(new Request('http://x', { method: 'POST', body: JSON.stringify({ plan: 'growth' }) }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('complimentary Enterprise');
  });

  it('the same name from another email domain stays on the trial, even after confirming', async () => {
    await signup('Eye Tek Security Services, LLC', 'impostor');
    await verify('impostor');
    expect(await orgOf('impostor')).toMatchObject({ plan: 'starter', subscriptionStatus: 'trialing', complimentary: false });
  });

  it('the deploy step grants it to an Eye Tek company that confirmed before, and doesn’t take it from one that hasn’t confirmed yet', async () => {
    await signup('Eye Tek Guards', 'eyetek2');
    const o = await orgOf('eyetek2');
    await db.organization.update({ where: { id: o.id }, data: { complimentary: true, complimentaryBy: 'list', plan: 'enterprise', subscriptionStatus: 'active' } }); // granted under the old rule
    expect((await applyComplimentary(db, COMPLIMENTARY, 14, [o.id]))).toEqual([]); // unconfirmed owner at the domain: kept
    await db.organization.update({ where: { id: o.id }, data: { complimentary: false, complimentaryBy: null, plan: 'starter', subscriptionStatus: 'trialing' } });
    await db.user.update({ where: { email: addr('eyetek2') }, data: { emailVerifiedAt: new Date() } });
    expect((await applyComplimentary(db, COMPLIMENTARY, 14, [o.id]))).toEqual(['Eye Tek Guards']);
  });

  it('Stripe never changes a complimentary plan', async () => {
    const o = await orgOf('eyetek');
    await db.organization.update({ where: { id: o.id }, data: { stripeCustomerId: `cus_${RUN}` } });
    await syncSubscription({ id: `sub_${RUN}`, customer: `cus_${RUN}`, status: 'canceled', current_period_end: 2e9, trial_end: null, items: { data: [] } } as unknown as Stripe.Subscription);
    expect(await db.organization.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ plan: 'enterprise', subscriptionStatus: 'active' });
  });

  it('the deploy step upgrades a company that signed up before it was on the list, and can require an email domain', async () => {
    const org = await db.organization.create({ data: { name: 'Acme Guards LLC', slug: `acme-${RUN}`, subscriptionStatus: 'trialing', trialEndsAt: new Date() } });
    const u = await db.user.create({ data: { email: `boss@${RUN}.test`, name: 'Boss', passwordHash: 'x', emailVerifiedAt: new Date() } });
    await db.membership.create({ data: { userId: u.id, organizationId: org.id, role: 'OWNER' } });
    const acme = async (l: typeof list) => (await applyComplimentary(db, l)).filter((n) => n.startsWith('Acme Guards'));
    const list = [{ name: 'Acme Guards', plan: 'enterprise' as const, domains: ['acme.example'], note: 'test' }];
    expect(await acme(list)).toEqual([]); // owner isn't at acme.example
    list[0].domains = [`${RUN}.test`];
    expect(await acme(list)).toEqual(['Acme Guards LLC']);
    expect(await db.organization.findUniqueOrThrow({ where: { id: org.id } })).toMatchObject({ plan: 'enterprise', subscriptionStatus: 'active', trialEndsAt: null, complimentary: true });
    expect(await acme(list)).toEqual([]); // already done
    // Off the list (or the owner's domain no longer matches): it ends, with a fresh trial to choose a plan.
    list[0].domains = ['acme.example'];
    expect(await acme(list)).toEqual(['Acme Guards LLC (ended; trial started)']);
    const after = await db.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(after).toMatchObject({ complimentary: false, subscriptionStatus: 'trialing' });
    expect(after.trialEndsAt!.getTime()).toBeGreaterThan(Date.now() + 13 * 864e5);
  });
});
