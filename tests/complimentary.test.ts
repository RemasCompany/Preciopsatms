import { afterAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ id: 'e' })) }));

import { db } from '@/lib/db';
import { POST as SIGNUP } from '@/app/api/signup/route';
import { POST as CHECKOUT } from '@/app/api/stripe/checkout/route';
import { syncSubscription } from '@/lib/stripe';
import { complimentaryFor, normalizeCompany, COMPLIMENTARY } from '@/lib/complimentary';
import { applyComplimentary } from '../scripts/complimentary.mjs';
import type Stripe from 'stripe';

const RUN = `cp${Date.now()}`;
// Owners at Eye Tek's own domain use a unique address per run, so tests never collide (no email is sent: it's mocked).
const addr = (who: string) => (who.startsWith('eyetek') ? `${who}.${RUN}@eyeteksecurity.com` : `${who}@${RUN}.test`);
const signup = (company: string, who: string) => SIGNUP(new Request('http://x', { method: 'POST', body: JSON.stringify({ company, name: 'Pat Owner', email: addr(who), password: 'long-enough-1' }) }));
const orgOf = async (who: string) => (await db.membership.findFirstOrThrow({ where: { user: { email: addr(who) } }, include: { organization: true } })).organization;
const mine = { OR: [{ email: { endsWith: `@${RUN}.test` } }, { email: { endsWith: `.${RUN}@eyeteksecurity.com` } }] };

afterAll(async () => {
  const users = await db.user.findMany({ where: mine, select: { id: true } });
  await db.organization.deleteMany({ where: { OR: [{ members: { some: { userId: { in: users.map((u) => u.id) } } } }, { slug: { endsWith: RUN } }] } });
  await db.user.deleteMany({ where: mine });
  await db.$disconnect();
});

describe('complimentary plans', () => {
  it('Eye Tek Security Services is on the list for Enterprise, for owners at eyeteksecurity.com, however the name is typed', () => {
    expect(COMPLIMENTARY.find((c) => c.name === 'Eye Tek Security Services, LLC')).toMatchObject({ plan: 'enterprise', domains: ['eyeteksecurity.com'] });
    for (const n of ['Eye Tek Security Services, LLC', 'Eye Tek Security Services LLC', 'EYE-TEK SECURITY SERVICES', 'EyeTek Security Services, L.L.C.', 'eye tek security services inc'])
      expect(complimentaryFor(n, 'owner@eyeteksecurity.com')?.plan, n).toBe('enterprise');
    expect(complimentaryFor('Eye Tek Security Services, LLC', 'Owner@EyeTekSecurity.com')?.plan).toBe('enterprise');
    expect(complimentaryFor('Eye Tek Security Services, LLC', 'owner@mail.eyeteksecurity.com')?.plan).toBe('enterprise');
    for (const e of ['owner@gmail.com', 'owner@eyeteksecurity.com.evil.io', 'owner@noteyeteksecurity.com', null]) expect(complimentaryFor('Eye Tek Security Services, LLC', e), String(e)).toBeNull();
    for (const n of ['Eye Tek Security', 'Eye Tek Security Services Group', 'Tek Security Services']) expect(complimentaryFor(n, 'owner@eyeteksecurity.com'), n).toBeNull();
    expect(normalizeCompany('A & B, Inc.')).toBe('aandb');
  });

  it('signs up straight onto free Enterprise: active, no trial, no billing account, nothing to pay', async () => {
    expect((await signup('Eye Tek Security Services, LLC', 'eyetek')).status).toBe(200);
    const o = await orgOf('eyetek');
    expect(o).toMatchObject({ plan: 'enterprise', subscriptionStatus: 'active', trialEndsAt: null, complimentary: true, stripeCustomerId: null });
    const user = await db.user.findUniqueOrThrow({ where: { email: addr('eyetek') } });
    session.current = { user: { id: user.id, orgId: o.id } };
    const r = await CHECKOUT(new Request('http://x', { method: 'POST', body: JSON.stringify({ plan: 'growth' }) }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('complimentary Enterprise');
  });

  it('other companies, and the same name from another email domain, still start on the trial', async () => {
    await signup('Eye Tek Security', 'lookalike');
    expect(await orgOf('lookalike')).toMatchObject({ plan: 'starter', subscriptionStatus: 'trialing', complimentary: false });
    await signup('Eye Tek Security Services, LLC', 'impostor');
    expect(await orgOf('impostor')).toMatchObject({ plan: 'starter', subscriptionStatus: 'trialing', complimentary: false });
  });

  it('Stripe never changes a complimentary plan', async () => {
    const o = await orgOf('eyetek');
    await db.organization.update({ where: { id: o.id }, data: { stripeCustomerId: `cus_${RUN}` } });
    await syncSubscription({ id: `sub_${RUN}`, customer: `cus_${RUN}`, status: 'canceled', current_period_end: 2e9, trial_end: null, items: { data: [] } } as unknown as Stripe.Subscription);
    expect(await db.organization.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ plan: 'enterprise', subscriptionStatus: 'active' });
  });

  it('the deploy step upgrades a company that signed up before it was on the list, and can require an email domain', async () => {
    const org = await db.organization.create({ data: { name: 'Acme Guards LLC', slug: `acme-${RUN}`, subscriptionStatus: 'trialing', trialEndsAt: new Date() } });
    const u = await db.user.create({ data: { email: `boss@${RUN}.test`, name: 'Boss', passwordHash: 'x' } });
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
