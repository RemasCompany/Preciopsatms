import { requireApiContext, HttpError, logActivity } from '@/lib/tenant';
import { refreshConnect } from '@/lib/online-payments';
import { captureError } from '@/lib/monitoring';

export const dynamic = 'force-dynamic';
const back = (q: string) => new Response(null, { status: 303, headers: { Location: `/app/settings?${q}#payments` } });

/** Where Stripe sends the admin back after onboarding: checks whether the account can take payments yet. */
export async function GET() {
  try {
    const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'invoicing' });
    const ready = await refreshConnect(org);
    if (ready && !org.stripeConnectReady) await logActivity(org.id, 'Stripe is connected: clients can pay invoices online once it’s switched on', user.id);
    return back(`payments=${ready ? 'connected' : 'pending'}`);
  } catch (e) {
    if (e instanceof HttpError) return e.status === 401 ? new Response(null, { status: 303, headers: { Location: '/login' } }) : back(`payments_error=${encodeURIComponent(e.message)}`);
    await captureError(e, { route: '/api/payments/connect/return', method: 'GET' });
    return back(`payments_error=${encodeURIComponent('Stripe couldn’t be reached. Press “Check status” in a minute.')}`);
  }
}

/** “Check status” on the settings card. */
export const POST = async () => {
  try {
    const { org } = await requireApiContext({ minRole: 'ADMIN', feature: 'invoicing' });
    return Response.json({ ready: await refreshConnect(org) });
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
    await captureError(e, { route: '/api/payments/connect/return', method: 'POST' });
    return Response.json({ error: 'Stripe couldn’t be reached. Try again in a minute.' }, { status: 502 });
  }
};
