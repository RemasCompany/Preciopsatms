import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function sendEmail(opts: { to: string | string[]; subject: string; text: string; replyTo?: string; fromName?: string; attachments?: { filename: string; content: Buffer }[] }) {
  if (!resend) { console.warn('[email] RESEND_API_KEY not set — email not sent:', opts.subject); return { id: 'dev-noop' }; }
  const from = opts.fromName ? `${opts.fromName} <${(process.env.EMAIL_FROM ?? '').replace(/.*</, '').replace('>', '')}>` : process.env.EMAIL_FROM!;
  const { data, error } = await resend.emails.send({
    from, to: opts.to, subject: opts.subject, text: opts.text, replyTo: opts.replyTo,
    attachments: opts.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
  });
  if (error) throw new Error(error.message);
  return { id: data?.id ?? '' };
}
