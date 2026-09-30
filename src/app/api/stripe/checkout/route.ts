import { z } from 'zod';
import { stripe, stripeEnabled } from '@/lib/stripe';
import { priceIdFor, PLANS } from '@/lib/plans';
import { db } from '@/lib/db';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { audit } from '@/lib/audit';

export const POST = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'OWNER' });
  const { plan } = z.object({ plan: z.enum(['starter', 'growth', 'enterprise']) }).parse(await req.json());
  if (!stripeEnabled()) throw new HttpError(503, 'Billing isn’t set up on this server yet. Your trial continues in the meantime.');
  let customer = org.stripeCustomerId;
  if (!customer) {
    const owner = await db.membership.findFirst({ where: { organizationId: org.id, role: 'OWNER' }, include: { user: true }, orderBy: { createdAt: 'asc' } });
    customer = (await stripe.customers.create({ email: owner?.user.email, name: org.name, metadata: { slug: org.slug } })).id;
    await db.organization.update({ where: { id: org.id }, data: { stripeCustomerId: customer } });
  }
  const seats = PLANS[plan].perSeat ? await db.membership.count({ where: { organizationId: org.id } }) : 1;
  const remainingTrial = org.trialEndsAt ? Math.ceil((org.trialEndsAt.getTime() - Date.now()) / 864e5) : 0;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price: priceIdFor(plan), quantity: seats }],
    subscription_data: remainingTrial > 0 && !org.stripeSubscriptionId ? { trial_period_days: remainingTrial } : undefined,
    allow_promotion_codes: true,
    billing_address_collection: 'required',
    automatic_tax: { enabled: true },
    customer_update: { address: 'auto' },
    success_url: `${process.env.APP_URL}/app/billing?status=success`,
    cancel_url: `${process.env.APP_URL}/app/billing`,
  });
  await audit(org.id, user, 'billing.checkout', `Started checkout for the ${PLANS[plan].name} plan (${seats} seat${seats === 1 ? '' : 's'})`, { req });
  return Response.json({ url: session.url });
});
