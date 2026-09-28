import type Stripe from 'stripe';
import { stripe, syncSubscription } from '@/lib/stripe';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature');
  const raw = await req.text();
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(raw, sig ?? '', process.env.STRIPE_WEBHOOK_SECRET ?? ''); }
  catch { return new Response('Invalid signature', { status: 400 }); }

  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.subscription) await syncSubscription(await stripe.subscriptions.retrieve(String(s.subscription)));
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.trial_will_end':
      await syncSubscription(event.data.object as Stripe.Subscription);
      break;
    case 'invoice.payment_failed':
    case 'invoice.paid': {
      const inv = event.data.object as Stripe.Invoice;
      if (inv.subscription) await syncSubscription(await stripe.subscriptions.retrieve(String(inv.subscription)));
      break;
    }
  }
  return Response.json({ received: true });
}
