import { HttpError } from '@/lib/tenant';
import { startCheckout } from '@/lib/online-payments';
import { limited } from '@/lib/rate-limit';
import { captureError } from '@/lib/monitoring';

export const dynamic = 'force-dynamic';

/** Public: the Pay online page's buttons. Opens Stripe Checkout for the invoice's balance, by bank transfer or card. */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const page = `/pay/${encodeURIComponent(params.token)}`;
  const back = (msg: string) => new Response(null, { status: 303, headers: { Location: `${page}?error=${encodeURIComponent(msg)}` } });
  const form = await req.formData().catch(() => null);
  const method = form?.get('method') === 'card' ? 'card' : 'ach';
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  if (await limited('pay-checkout', `${ip}:${params.token}`, 10)) return back('Too many tries. Wait a few minutes and try again.');
  try {
    return new Response(null, { status: 303, headers: { Location: await startCheckout(params.token, method) } });
  } catch (e) {
    if (e instanceof HttpError) return back(e.message);
    await captureError(e, { route: '/api/pay/[token]/checkout', method: 'POST' });
    return back('The payment page couldn’t be opened. Try again in a minute.');
  }
}
