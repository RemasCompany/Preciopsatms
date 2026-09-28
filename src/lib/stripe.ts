import Stripe from 'stripe';
import { db } from './db';
import { PLANS, planFromPriceId } from './plans';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_missing', { typescript: true });

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

/** Keep per-seat quantity equal to the number of members. Call after invite acceptance / member removal. */
export async function syncSeats(orgId: string) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  if (!org.stripeSubscriptionId || !PLANS[org.plan].perSeat) return;
  const count = await db.membership.count({ where: { organizationId: orgId } });
  const sub = await stripe.subscriptions.retrieve(org.stripeSubscriptionId);
  const item = sub.items.data[0];
  if (item && item.quantity !== count) {
    await stripe.subscriptionItems.update(item.id, { quantity: count, proration_behavior: 'create_prorations' });
  }
}

export function seatLimitReached(org: { plan: keyof typeof PLANS }, currentMembers: number) {
  const max = PLANS[org.plan].maxSeats;
  return max !== null && currentMembers >= max;
}
