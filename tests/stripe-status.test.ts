import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { stripeStatus } from '@/lib/stripe-status';

const APP = 'https://preciopsatms.com';
const allPrices = { STRIPE_PRICE_STARTER: 'price_s', STRIPE_PRICE_GROWTH: 'price_g', STRIPE_PRICE_ENTERPRISE: 'price_e', STRIPE_PRICE_STARTER_EMPLOYER: 'price_se', STRIPE_PRICE_GROWTH_EMPLOYER: 'price_ge', STRIPE_PRICE_ENTERPRISE_EMPLOYER: 'price_ee' };
const env = (over: Record<string, string | undefined> = {}) => ({ STRIPE_SECRET_KEY: 'sk_live_abcdefghijklmnop', STRIPE_WEBHOOK_SECRET: 'whsec_abc', APP_URL: APP, ...allPrices, ...over });

function fake(o: { balance?: () => unknown; prices?: Record<string, Partial<Stripe.Price>>; hooks?: { url: string; status: string }[] | 'forbidden'; live?: boolean } = {}) {
  const live = o.live ?? true;
  const price = (id: string): Partial<Stripe.Price> => ({ id, active: true, livemode: live, unit_amount: 9900, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } as Stripe.Price.Recurring, ...(o.prices?.[id] ?? {}) });
  return {
    balance: { retrieve: async () => (o.balance ? o.balance() : {}) },
    prices: { retrieve: async (id: string) => { if (id === 'price_missing') throw new Error('No such price'); return price(id); } },
    webhookEndpoints: { list: async () => { if (o.hooks === 'forbidden') throw Object.assign(new Error('perm'), { type: 'StripePermissionError' }); return { data: o.hooks ?? [{ url: `${APP}/api/stripe/webhook`, status: 'enabled' }] }; } },
  } as unknown as Stripe;
}

describe('Stripe connection check', () => {
  it('not connected without a key, and catches a publishable key pasted by mistake', async () => {
    expect((await stripeStatus({ STRIPE_SECRET_KEY: '' }, fake())).state).toBe('not_connected');
    expect((await stripeStatus({ STRIPE_SECRET_KEY: 'sk_test_...' }, fake())).state).toBe('not_connected');
    const pk = await stripeStatus(env({ STRIPE_SECRET_KEY: 'pk_live_123456' }), fake());
    expect(pk.state).toBe('problems');
    expect(pk.problems[0]).toContain('publishable key');
  });
  it('fully connected in live mode', async () => {
    const s = await stripeStatus(env(), fake());
    expect(s).toMatchObject({ state: 'connected', mode: 'live', problems: [], webhook: { ok: true } });
    expect(s.summary).toContain('live mode');
    expect(s.prices.every((p) => p.ok)).toBe(true);
    expect(s.prices[0].note).toBe('$99.00 per month');
    expect(JSON.stringify(s)).not.toContain('sk_live_abcdefghijklmnop'); // never the key itself
    expect(JSON.stringify(s)).not.toContain('whsec_abc');
  });
  it('says plainly when it is only test mode', async () => {
    const s = await stripeStatus(env({ STRIPE_SECRET_KEY: 'sk_test_abcdefghijklmnop' }), fake({ live: false }));
    expect(s).toMatchObject({ state: 'connected', mode: 'test' });
    expect(s.summary).toContain('TEST mode');
  });
  it('reports a rejected key', async () => {
    const s = await stripeStatus(env(), fake({ balance: () => { throw Object.assign(new Error('bad'), { type: 'StripeAuthenticationError', statusCode: 401 }); } }));
    expect(s.state).toBe('problems');
    expect(s.summary).toContain('rejected');
  });
  it('flags missing, archived, one-time and wrong-mode prices, but Enterprise is optional', async () => {
    const s = await stripeStatus(env({ STRIPE_PRICE_GROWTH: 'price_missing', STRIPE_PRICE_STARTER_EMPLOYER: undefined, STRIPE_PRICE_ENTERPRISE: undefined }),
      fake({ prices: { price_s: { active: false }, price_ge: { livemode: false }, price_se: {} } }));
    expect(s.state).toBe('problems');
    const by = (k: string) => s.prices.find((p) => p.setting === k)!;
    expect(by('STRIPE_PRICE_STARTER').note).toContain('archived');
    expect(by('STRIPE_PRICE_GROWTH').note).toContain('no price');
    expect(by('STRIPE_PRICE_GROWTH_EMPLOYER').note).toContain('test mode but the key is live');
    expect(by('STRIPE_PRICE_STARTER_EMPLOYER').note).toContain('can’t be bought');
    expect(by('STRIPE_PRICE_ENTERPRISE').note).toContain('optional');
    expect(s.problems.some((p) => p.startsWith('STRIPE_PRICE_ENTERPRISE'))).toBe(false);
    expect(s.problems).toHaveLength(4);
  });
  it('checks that Stripe is sending updates to this site', async () => {
    expect((await stripeStatus(env({ STRIPE_WEBHOOK_SECRET: '' }), fake())).webhook.ok).toBe(false);
    const none = await stripeStatus(env(), fake({ hooks: [{ url: 'https://old-site.example/api/stripe/webhook', status: 'enabled' }] }));
    expect(none.webhook.note).toContain(`${APP}/api/stripe/webhook`);
    expect(none.state).toBe('problems');
    expect((await stripeStatus(env(), fake({ hooks: [{ url: `${APP}/api/stripe/webhook/`, status: 'disabled' }] }))).webhook.note).toContain('disabled');
    const cant = await stripeStatus(env(), fake({ hooks: 'forbidden' }));
    expect(cant).toMatchObject({ state: 'connected', webhook: { ok: null } }); // can't check isn't a failure
  });
});
