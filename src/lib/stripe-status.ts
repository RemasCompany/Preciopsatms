import Stripe from 'stripe';
import { PLANS, type PlanId } from './plans';

/**
 * Is Stripe connected, and will checkout and subscription sync work? Checks the settings, then asks Stripe itself:
 * the key works, each plan's price exists and is a monthly recurring price in the same mode as the key, and a webhook
 * endpoint is sending to this site. Names settings, never their values. Cached for 10 minutes.
 */
export type StripeStatus = {
  state: 'connected' | 'problems' | 'not_connected';
  mode: 'live' | 'test' | null;
  summary: string;
  problems: string[];
  prices: { setting: string; plan: string; ok: boolean; note: string }[];
  webhook: { ok: boolean | null; note: string };
};

const placeholder = (v: string | undefined) => !v || /^(|\.\.\.|sk_test_\.\.\.|whsec_\.\.\.|price_\.\.\.)$/.test(v.trim());

let cache: { at: number; value: StripeStatus } | null = null;

export async function stripeStatus(env: Record<string, string | undefined> = process.env, client?: Stripe, fresh = false): Promise<StripeStatus> {
  if (!fresh && !client && cache && Date.now() - cache.at < 600e3) return cache.value;
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (placeholder(key)) return { state: 'not_connected', mode: null, summary: 'Stripe isn’t connected: STRIPE_SECRET_KEY isn’t set, so companies stay on the free trial and can’t buy a plan.', problems: ['Set STRIPE_SECRET_KEY in Vercel (Production) to your Stripe secret key, then redeploy.'], prices: [], webhook: { ok: null, note: 'Not checked.' } };
  const m = /^(sk|rk)_(live|test)_/.exec(key!);
  if (!m) return { state: 'problems', mode: null, summary: 'STRIPE_SECRET_KEY doesn’t look like a Stripe secret key.', problems: ['STRIPE_SECRET_KEY should start with sk_live_ (or sk_test_ for testing). A publishable key (pk_…) won’t work.'], prices: [], webhook: { ok: null, note: 'Not checked.' } };
  const mode = m[2] as 'live' | 'test';
  const stripe = client ?? new Stripe(key!, { typescript: true });
  const problems: string[] = [];

  // The key itself.
  try { await stripe.balance.retrieve(); }
  catch (e) {
    const err = e as { type?: string; statusCode?: number; message?: string };
    const why = err.type === 'StripeAuthenticationError' || err.statusCode === 401 ? 'Stripe rejected STRIPE_SECRET_KEY (it may have been rolled or deleted). Copy a current secret key from Stripe → Developers → API keys.'
      : err.type === 'StripePermissionError' || err.statusCode === 403 ? null // a restricted key without balance access can still work; the price checks below decide
      : `Couldn’t reach Stripe (${(err.message ?? 'network error').slice(0, 120)}).`;
    if (why) return { state: 'problems', mode, summary: why, problems: [why], prices: [], webhook: { ok: null, note: 'Not checked.' } };
  }

  // Each plan's price, for staffing agencies and for employers.
  const prices: StripeStatus['prices'] = [];
  for (const [id, p] of Object.entries(PLANS) as [PlanId, (typeof PLANS)[PlanId]][]) {
    for (const [setting, label] of [[p.priceEnv, `${p.name} (staffing agencies)`], [p.employer.priceEnv, `${p.employer.name} (employers)`]] as const) {
      const v = env[setting]?.trim();
      if (placeholder(v)) { prices.push({ setting, plan: label, ok: false, note: id === 'enterprise' ? 'Not set: Enterprise is sold by talking to sales, so this is optional.' : 'Not set: this plan can’t be bought.' }); continue; }
      try {
        const pr = await stripe.prices.retrieve(v!);
        const note = !pr.active ? 'This price is archived in Stripe.' : !pr.recurring ? 'This is a one-time price; plans need a recurring (monthly) price.'
          : pr.livemode !== (mode === 'live') ? `This price is in ${pr.livemode ? 'live' : 'test'} mode but the key is ${mode} mode.` : '';
        prices.push({ setting, plan: label, ok: !note, note: note || `${((pr.unit_amount ?? 0) / 100).toLocaleString('en-US', { style: 'currency', currency: (pr.currency || 'usd').toUpperCase() })} per ${pr.recurring!.interval}${pr.recurring!.interval_count > 1 ? ` (every ${pr.recurring!.interval_count})` : ''}` });
      } catch { prices.push({ setting, plan: label, ok: false, note: 'Stripe has no price with this ID in this account and mode.' }); }
    }
  }
  for (const x of prices) if (!x.ok && !x.setting.startsWith('STRIPE_PRICE_ENTERPRISE')) problems.push(`${x.setting}: ${x.note}`);

  // The webhook: the secret is set, and Stripe has an enabled endpoint sending to this site.
  let webhook: StripeStatus['webhook'];
  const app = env.APP_URL?.trim().replace(/\/$/, '');
  if (placeholder(env.STRIPE_WEBHOOK_SECRET) || !/^whsec_/.test(env.STRIPE_WEBHOOK_SECRET!.trim())) {
    webhook = { ok: false, note: 'STRIPE_WEBHOOK_SECRET isn’t set (it starts with whsec_), so payments and cancellations won’t update companies’ plans.' };
    problems.push(webhook.note);
  } else {
    try {
      const list = await stripe.webhookEndpoints.list({ limit: 100 });
      const ours = list.data.filter((w) => app && w.url.replace(/\/$/, '') === `${app}/api/stripe/webhook`);
      const live = ours.find((w) => w.status === 'enabled');
      webhook = live ? { ok: true, note: `Sending to ${app}/api/stripe/webhook.` }
        : ours.length ? { ok: false, note: 'The webhook endpoint for this site is disabled in Stripe. Enable it under Developers → Webhooks.' }
        : { ok: false, note: `No Stripe webhook sends to ${app ?? 'this site'}/api/stripe/webhook. Add one under Developers → Webhooks (events: checkout.session.completed and customer.subscription.*), then copy its signing secret into STRIPE_WEBHOOK_SECRET.` };
      if (!webhook.ok) problems.push(webhook.note);
    } catch { webhook = { ok: null, note: 'The webhook signing secret is set; this key isn’t allowed to list webhooks, so the endpoint wasn’t checked.' }; }
  }

  const value: StripeStatus = {
    state: problems.length ? 'problems' : 'connected', mode, problems, prices, webhook,
    summary: problems.length ? `Stripe is connected in ${mode} mode, but ${problems.length} thing${problems.length === 1 ? ' needs' : 's need'} fixing.`
      : mode === 'live' ? 'Stripe is connected in live mode: companies can buy plans and payments update their accounts.'
      : 'Stripe is connected in TEST mode: checkout works with test cards only, and no real payments are taken. Switch to live keys and prices to charge customers.',
  };
  if (!client) cache = { at: Date.now(), value };
  return value;
}
