import { z } from 'zod';
import { stripe } from '@/lib/stripe';
import { priceIdFor, PLANS } from '@/lib/plans';
import { db } from '@/lib/db';
import { requireApiContext, withApi } from '@/lib/tenant';

export const POST = withApi(async (req: Request) => {
  const { org } = await requireApiContext({ minRole: 'OWNER' });
  const { plan } = z.object({ plan: z.enum(['starter', 'growth', 'enterprise']) }).parse(await req.json());
  const seats = PLANS[plan].perSeat ? await db.membership.count({ where: { organizationId: org.id } }) : 1;
  const remainingTrial = org.trialEndsAt ? Math.ceil((org.trialEndsAt.getTime() - Date.now()) / 864e5) : 0;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: org.stripeCustomerId!,
    line_items: [{ price: priceIdFor(plan), quantity: seats }],
    subscription_data: remainingTrial > 0 && !org.stripeSubscriptionId ? { trial_period_days: remainingTrial } : undefined,
    allow_promotion_codes: true,
    billing_address_collection: 'required',
    automatic_tax: { enabled: true },
    customer_update: { address: 'auto' },
    success_url: `${process.env.APP_URL}/app/billing?status=success`,
    cancel_url: `${process.env.APP_URL}/app/billing`,
  });
  return Response.json({ url: session.url });
});
