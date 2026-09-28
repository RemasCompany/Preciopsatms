import { db } from '@/lib/db';
import { validateTwilioSignature, toE164 } from '@/lib/sms';

/** Twilio inbound webhook: STOP / START keywords update opt-out across every tenant that has this number. */
export async function POST(req: Request) {
  const form = await req.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const url = `${process.env.APP_URL}/api/sms/inbound`;
  if (!validateTwilioSignature(req.headers.get('x-twilio-signature') ?? '', url, params)) return new Response('Forbidden', { status: 403 });

  const from = toE164(params.From ?? '');
  const word = (params.Body ?? '').trim().toUpperCase();
  if (from) {
    const digits = from.replace(/\D/g, '').slice(-10);
    const matches = await db.candidate.findMany({ where: { phone: { contains: digits.slice(-4) } }, select: { id: true, phone: true } });
    const ids = matches.filter((c) => (c.phone ?? '').replace(/\D/g, '').endsWith(digits)).map((c) => c.id);
    if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(word)) await db.candidate.updateMany({ where: { id: { in: ids } }, data: { smsOptOut: true } });
    if (['START', 'UNSTOP', 'YES'].includes(word)) await db.candidate.updateMany({ where: { id: { in: ids } }, data: { smsOptOut: false } });
  }
  return new Response('<Response/>', { headers: { 'Content-Type': 'text/xml' } });
}
