import { stripe, stripeEnabled } from '@/lib/stripe';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';

export const POST = withApi(async () => {
  const { org } = await requireApiContext({ minRole: 'OWNER' });
  if (!stripeEnabled()) throw new HttpError(503, 'Billing isn’t set up on this server yet.');
  if (!org.stripeCustomerId) throw new HttpError(400, 'Choose a plan first.');
  const s = await stripe.billingPortal.sessions.create({ customer: org.stripeCustomerId, return_url: `${process.env.APP_URL}/app/billing` });
  return Response.json({ url: s.url });
});
