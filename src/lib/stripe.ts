import Stripe from 'stripe';
import { db } from './db';
import { PLANS, billedPerEmployee, planFromPriceId, priceIdFor, type OrgKind } from './plans';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_missing', { typescript: true });
/** Billing works only with a real Stripe key; without one, signups run on the free trial and checkout says billing isn't set up. */
export const stripeEnabled = () => /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}/.test(process.env.STRIPE_SECRET_KEY ?? '');

/** Mirror a Stripe subscription onto the organization. Called from the webhook. */
export async function syncSubscription(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const item = sub.items.data[0];
  const plan = item ? planFromPriceId(item.price.id) : null;
  const org = await db.organization.findUnique({ where: { stripeCustomerId: customerId } });
  if (!org) return;
  const periodEnd = new Date(sub.current_period_end * 1000);
  const newPeriod = !org.currentPeriodEnd || periodEnd.getTime() !== org.currentPeriodEnd.getTime();
  await db.organization.update({
    where: { id: org.id },
    data: {
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      plan: plan ?? org.plan,
      seats: item?.quantity ?? org.seats,
      currentPeriodEnd: periodEnd,
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      ...(newPeriod ? { aiCreditsUsed: 0 } : {}),
    },
  });
}

/** What the subscription is billed on: active employees for employers, users on per-seat agency plans (at least the plan's minimum), else 1. */
export async function billingQuantity(org: { id: string; plan: keyof typeof PLANS; kind: OrgKind }) {
  if (billedPerEmployee(org.kind)) return Math.max(1, await db.employee.count({ where: { organizationId: org.id, status: { not: 'TERMINATED' } } }));
  return PLANS[org.plan].perSeat ? Math.max(PLANS[org.plan].minSeats, await db.membership.count({ where: { organizationId: org.id } })) : 1;
}

/**
 * Keep the subscription's price and quantity in step with the company: the employer or agency price for its plan, and
 * the number of employees or users. Call after members or employees change, and when the company type changes.
 */
export async function syncSeats(orgId: string) {
  if (!stripeEnabled()) return;
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  if (!org.stripeSubscriptionId) return;
  const count = await billingQuantity(org);
  let price: string | null = null;
  try { price = priceIdFor(org.plan, org.kind); } catch { /* that price isn't configured: keep the current one */ }
  const sub = await stripe.subscriptions.retrieve(org.stripeSubscriptionId);
  const item = sub.items.data[0];
  if (item && (item.quantity !== count || (price && item.price.id !== price))) {
    await stripe.subscriptionItems.update(item.id, { quantity: count, ...(price ? { price } : {}), proration_behavior: 'create_prorations' });
  }
}

export function seatLimitReached(org: { plan: keyof typeof PLANS }, currentMembers: number) {
  const max = PLANS[org.plan].maxSeats;
  return max !== null && currentMembers >= max;
}
