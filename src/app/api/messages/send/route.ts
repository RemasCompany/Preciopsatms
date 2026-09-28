import { z } from 'zod';
import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { sendEmail } from '@/lib/email';
import { sendSms } from '@/lib/sms';
import { merge, orgContext } from '@/lib/merge';

const Body = z.object({
  channel: z.enum(['email', 'sms']),
  recipientType: z.enum(['candidate', 'lead', 'vendor', 'contact']),
  recipientIds: z.array(z.string()).min(1).max(500),
  jobId: z.string().optional(),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(5000),
});

type R = { id: string; name: string; email: string | null; phone: string | null; company?: string; emailOptOut?: boolean; smsOptOut?: boolean };

/** Sends individually-merged messages (never one BCC blast) and logs each one. Honors opt-outs. */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'messaging', write: true });
  const b = Body.parse(await req.json());
  if (b.channel === 'email' && !b.subject) throw new HttpError(400, 'Subject is required for email');

  let recips: R[] = [];
  if (b.recipientType === 'candidate') recips = await tdb.candidate.findMany({ where: { id: { in: b.recipientIds } } });
  if (b.recipientType === 'lead') recips = (await tdb.lead.findMany({ where: { id: { in: b.recipientIds } } })).map((l) => ({ id: l.id, name: l.contact ?? '', email: l.email, phone: l.phone, company: l.company }));
  if (b.recipientType === 'vendor') recips = (await tdb.vendor.findMany({ where: { id: { in: b.recipientIds } } })).map((v) => ({ id: v.id, name: v.contact ?? '', email: v.email, phone: v.phone, company: v.name }));
  if (b.recipientType === 'contact') recips = (await tdb.contact.findMany({ where: { id: { in: b.recipientIds } }, include: { client: true } })).map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, company: c.client.name }));

  const job = b.jobId ? await tdb.job.findFirst({ where: { id: b.jobId } }) : null;
  const base = { ...orgContext(org), job_title: job?.title, job_location: job?.location ?? undefined, pay_rate: job?.payRate ? `$${job.payRate}/hr` : undefined };
  const results = { sent: 0, skipped: 0, failed: 0 };

  for (const r of recips) {
    const ctx = { ...base, first_name: r.name.split(' ')[0] || 'there', company: r.company };
    const to = b.channel === 'email' ? r.email : r.phone;
    const optedOut = b.channel === 'email' ? r.emailOptOut : r.smsOptOut;
    if (!to || optedOut) {
      results.skipped++;
      await tdb.message.create({ data: { channel: b.channel, toAddress: to ?? '(none)', subject: b.subject, body: b.body, relatedType: b.recipientType, relatedId: r.id, status: optedOut ? 'blocked_opt_out' : 'failed', error: to ? 'Opted out' : 'No address', sentById: user.id } as never });
      continue;
    }
    const text = merge(b.body, ctx);
    try {
      const res = b.channel === 'email'
        ? await sendEmail({ to, subject: merge(b.subject!, ctx), text, replyTo: user.email, fromName: `${user.name ?? ''} at ${org.shortName ?? org.name}`.trim() })
        : await sendSms(to, text);
      await tdb.message.create({ data: { channel: b.channel, toAddress: to, subject: b.subject, body: text, relatedType: b.recipientType, relatedId: r.id, status: 'sent', providerId: res.id, sentById: user.id } as never });
      results.sent++;
    } catch (e) {
      results.failed++;
      await tdb.message.create({ data: { channel: b.channel, toAddress: to, subject: b.subject, body: text, relatedType: b.recipientType, relatedId: r.id, status: 'failed', error: String((e as Error).message).slice(0, 300), sentById: user.id } as never });
    }
  }
  await logActivity(org.id, `${b.channel === 'email' ? 'Emailed' : 'Texted'} ${results.sent} ${b.recipientType}${results.sent === 1 ? '' : 's'}`, user.id);
  return Response.json(results);
});
