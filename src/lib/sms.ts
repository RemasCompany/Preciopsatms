import twilio from 'twilio';

const client = process.env.TWILIO_ACCOUNT_SID ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN) : null;

export function toE164(phone: string) {
  const d = phone.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return phone.startsWith('+') ? `+${d}` : null;
}

export async function sendSms(to: string, body: string) {
  const num = toE164(to);
  if (!num) throw new Error('Invalid phone number');
  if (!client) { console.warn('[sms] Twilio not configured — SMS not sent to', num); return { id: 'dev-noop' }; }
  // Carriers require opt-out language on business texts.
  const msg = await client.messages.create({ to: num, messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID, body: /stop/i.test(body) ? body : `${body}\n\nReply STOP to opt out.` });
  return { id: msg.sid };
}

export function validateTwilioSignature(signature: string, url: string, params: Record<string, string>) {
  return twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN ?? '', signature, url, params);
}
