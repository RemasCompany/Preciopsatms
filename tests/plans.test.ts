import { afterEach, describe, expect, it } from 'vitest';
import { PLANS, hasFeature, planFromPriceId, priceIdFor, type Feature, type PlanId } from '@/lib/plans';

const org = (plan: PlanId, subscriptionStatus = 'active') => ({ plan, subscriptionStatus });

describe('plan feature gating', () => {
  it.each<[PlanId, Feature, boolean]>([
    ['starter', 'ats', true], ['starter', 'careers', true], ['starter', 'timesheets', false], ['starter', 'ai', false], ['starter', 'eeo', false],
    ['growth', 'timesheets', true], ['growth', 'esign', true], ['growth', 'ai', true], ['growth', 'eeo', false], ['growth', 'sso', false],
    ['enterprise', 'eeo', true], ['enterprise', 'sso', true], ['enterprise', 'whitelabel', true],
  ])('%s → %s = %s', (plan, feature, expected) => {
    expect(hasFeature(org(plan), feature)).toBe(expected);
  });

  it('allows features while trialing', () => {
    expect(hasFeature(org('growth', 'trialing'), 'timesheets')).toBe(true);
  });

  it.each(['past_due', 'canceled', 'unpaid', 'incomplete'])('blocks every feature when status is %s', (status) => {
    expect(hasFeature(org('enterprise', status), 'ats')).toBe(false);
  });

  it('each higher plan includes everything in the lower one', () => {
    expect(PLANS.starter.features.every((f) => PLANS.growth.features.includes(f))).toBe(true);
    expect(PLANS.growth.features.every((f) => PLANS.enterprise.features.includes(f))).toBe(true);
  });
});

describe('Stripe price mapping', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('maps plans to price IDs and back', () => {
    process.env.STRIPE_PRICE_STARTER = 'price_s'; process.env.STRIPE_PRICE_GROWTH = 'price_g'; process.env.STRIPE_PRICE_ENTERPRISE = 'price_e';
    expect(priceIdFor('growth')).toBe('price_g');
    expect(planFromPriceId('price_e')).toBe('enterprise');
    expect(planFromPriceId('price_unknown')).toBeNull();
  });

  it('throws a clear error when a price ID is missing', () => {
    delete process.env.STRIPE_PRICE_GROWTH;
    expect(() => priceIdFor('growth')).toThrow('Missing STRIPE_PRICE_GROWTH');
  });
});
