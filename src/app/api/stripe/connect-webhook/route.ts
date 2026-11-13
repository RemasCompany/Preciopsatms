import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { handleConnectEvent } from '@/lib/online-payments';
import { captureError } from '@/lib/monitoring';

export const runtime = 'nodejs';

/**
 * Events from the firms' own Stripe accounts (a "Connected accounts" webhook endpoint in Stripe, with its own signing
 * secret, STRIPE_CONNECT_WEBHOOK_SECRET): invoice payments and account status. Subscription events use /api/stripe/webhook.
 */
export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature');
  const raw = await req.text();
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(raw, sig ?? '', process.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? ''); }
  catch { return new Response('Invalid signature', { status: 400 }); }
  try {
    return Response.json({ received: true, result: await handleConnectEvent(event) });
  } catch (e) {
    await captureError(e, { route: '/api/stripe/connect-webhook', method: 'POST', tags: { event: event.type } });
    return Response.json({ error: 'Not processed' }, { status: 500 }); // Stripe retries
  }
}
