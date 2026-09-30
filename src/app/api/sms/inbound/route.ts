import { validateTwilioSignature } from '@/lib/sms';
import { receive } from '@/lib/sms-inbox';
import { captureError } from '@/lib/monitoring';

/** Twilio inbound webhook: STOP/START update opt-outs; every reply lands in the right company's inbox. */
export async function POST(req: Request) {
  const form = await req.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const url = `${process.env.APP_URL}/api/sms/inbound`;
  if (!validateTwilioSignature(req.headers.get('x-twilio-signature') ?? '', url, params)) return new Response('Forbidden', { status: 403 });
  try {
    await receive({ from: params.From ?? '', to: params.To ?? null, body: params.Body ?? '', sid: params.MessageSid });
  } catch (e) {
    await captureError(e, { route: '/api/sms/inbound', method: 'POST' });
  }
  return new Response('<Response/>', { headers: { 'Content-Type': 'text/xml' } });
}
