import { stripe } from '@/lib/stripe';
import { requireApiContext, withApi } from '@/lib/tenant';

export const POST = withApi(async () => {
  const { org } = await requireApiContext({ minRole: 'OWNER' });
  const s = await stripe.billingPortal.sessions.create({ customer: org.stripeCustomerId!, return_url: `${process.env.APP_URL}/app/billing` });
  return Response.json({ url: s.url });
});
