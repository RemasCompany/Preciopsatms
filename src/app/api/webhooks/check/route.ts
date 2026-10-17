import { verifyWebhook } from '@/lib/check-payroll';
import { applyWebhook } from '@/lib/payroll-provider';
import { captureError } from '@/lib/monitoring';

/** Check webhook (set https://<your-app>/api/webhooks/check in Check, and its signing secret as CHECK_WEBHOOK_SECRET). */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get('x-checkhq-signature'))) return Response.json({ error: 'Bad signature' }, { status: 401 });
  try {
    return Response.json({ ok: true, applied: await applyWebhook(JSON.parse(raw)) });
  } catch (e) {
    await captureError(e, { route: '/api/webhooks/check', method: 'POST' });
    return Response.json({ error: 'Failed' }, { status: 500 }); // Check retries
  }
}
