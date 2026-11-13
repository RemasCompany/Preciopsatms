import { requireApiContext, HttpError } from '@/lib/tenant';
import { connectLink } from '@/lib/online-payments';
import { captureError } from '@/lib/monitoring';

export const dynamic = 'force-dynamic';
const back = (q: string) => new Response(null, { status: 303, headers: { Location: `/app/settings?${q}#payments` } });

/** Settings → Payments → Connect Stripe: sends an admin to Stripe to set up (or finish) the company's own account. */
export async function GET() {
  try {
    const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'invoicing', write: true });
    return new Response(null, { status: 303, headers: { Location: await connectLink(org, user) } });
  } catch (e) {
    if (e instanceof HttpError) return e.status === 401 ? new Response(null, { status: 303, headers: { Location: '/login' } }) : back(`payments_error=${encodeURIComponent(e.message)}`);
    await captureError(e, { route: '/api/payments/connect', method: 'GET' });
    return back(`payments_error=${encodeURIComponent('Stripe couldn’t be reached. Try again in a minute.')}`);
  }
}
