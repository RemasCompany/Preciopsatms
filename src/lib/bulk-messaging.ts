import { z } from 'zod';
import type { Organization, User } from '@prisma/client';
import { db } from './db';
import { HttpError, logActivity, tenantDb } from './tenant';
import { sendEmail } from './email';
import { sendSms } from './sms';
import { merge, orgContext } from './merge';
import { Yield, enqueue, registerTask, type TaskCtx } from './tasks';

export const SendBody = z.object({
  channel: z.enum(['email', 'sms']),
  recipientType: z.enum(['candidate', 'lead', 'vendor', 'contact']),
  recipientIds: z.array(z.string()).min(1, 'Choose at least one person.').max(2000, 'Send to at most 2,000 people at a time.'),
  jobId: z.string().optional(),
  subject: z.string().max(200).optional(),
  body: z.string().min(1, 'Write a message.').max(5000),
});
export type SendInput = z.infer<typeof SendBody>;

/** Up to this many are sent while you wait; more go to the background queue. */
export const INLINE_MAX = 25;

type R = { id: string; name: string; email: string | null; phone: string | null; company?: string; emailOptOut?: boolean; smsOptOut?: boolean };
export type Tally = { sent: number; skipped: number; failed: number };

async function recipients(orgId: string, b: SendInput): Promise<R[]> {
  const tdb = tenantDb(orgId), where = { id: { in: b.recipientIds } };
  if (b.recipientType === 'candidate') return tdb.candidate.findMany({ where });
  if (b.recipientType === 'lead') return (await tdb.lead.findMany({ where })).map((l) => ({ id: l.id, name: l.contact ?? '', email: l.email, phone: l.phone, company: l.company, emailOptOut: l.emailOptOut, smsOptOut: l.smsOptOut }));
  if (b.recipientType === 'vendor') return (await tdb.vendor.findMany({ where })).map((v) => ({ id: v.id, name: v.contact ?? '', email: v.email, phone: v.phone, company: v.name }));
  return (await tdb.contact.findMany({ where, include: { client: true } })).map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, company: c.client.name, emailOptOut: c.emailOptOut, smsOptOut: c.smsOptOut }));
}

/**
 * Sends individually merged messages (never one BCC blast) and logs each one. Honors opt-outs.
 * `skip` holds recipients already handled by an earlier attempt, so a retried task never messages anyone twice.
 */
export async function sendBulk(org: Organization, user: User, b: SendInput, opt: { skip?: Set<string>; after?: (id: string, t: Tally) => Promise<void>; deadline?: number; start?: Tally } = {}) {
  if (b.channel === 'email' && !b.subject) throw new HttpError(400, 'Subject is required for email');
  const tdb = tenantDb(org.id);
  const job = b.jobId ? await tdb.job.findFirst({ where: { id: b.jobId } }) : null;
  const base = { ...orgContext(org), job_title: job?.title, job_location: job?.location ?? undefined, pay_rate: job?.payRate ? `$${job.payRate}/hr` : undefined };
  const t: Tally = { ...(opt.start ?? { sent: 0, skipped: 0, failed: 0 }) };
  const log = (data: object) => tdb.message.create({ data: { channel: b.channel, relatedType: b.recipientType, sentById: user.id, ...data } as never });

  for (const r of await recipients(org.id, b)) {
    if (opt.skip?.has(r.id)) continue;
    if (opt.deadline && Date.now() > opt.deadline) throw new Yield();
    const ctx = { ...base, first_name: r.name.split(' ')[0] || 'there', company: r.company };
    const to = b.channel === 'email' ? r.email : r.phone;
    const optedOut = b.channel === 'email' ? r.emailOptOut : r.smsOptOut;
    const text = merge(b.body, ctx);
    const subject = b.subject ? merge(b.subject, ctx) : undefined;
    const blank = `${subject ?? ''} ${text}`.match(/\{\{(\w+)\}\}/);
    if (!to || optedOut) {
      t.skipped++;
      await log({ toAddress: to ?? '(none)', subject, body: text, relatedId: r.id, status: optedOut ? 'blocked_opt_out' : 'failed', error: to ? 'Opted out' : 'No address' });
    } else if (blank) {
      // Never send a message with a raw {{field}} in it.
      t.failed++;
      await log({ toAddress: to, subject, body: text, relatedId: r.id, status: 'failed', error: `No value for {{${blank[1]}}} — edit the message or fill in the record first.` });
    } else {
      try {
        const res = b.channel === 'email'
          ? await sendEmail({ to, subject: subject!, text, replyTo: user.email, fromName: `${user.name ?? ''} at ${org.shortName ?? org.name}`.trim() })
          : await sendSms(to, text);
        await log({ toAddress: to, subject, body: text, relatedId: r.id, status: 'sent', providerId: res.id });
        t.sent++;
      } catch (e) {
        t.failed++;
        await log({ toAddress: to, subject, body: text, relatedId: r.id, status: 'failed', error: String((e as Error).message).slice(0, 300) });
      }
    }
    await opt.after?.(r.id, t);
  }
  return t;
}

export const summary = (b: Pick<SendInput, 'channel' | 'recipientType'>, t: Tally) => `${b.channel === 'email' ? 'Emailed' : 'Texted'} ${t.sent} ${b.recipientType}${t.sent === 1 ? '' : 's'}${t.skipped ? `, skipped ${t.skipped}` : ''}${t.failed ? `, ${t.failed} failed` : ''}`;

type Progress = Tally & { total: number; done: string[] };

/** Queues a large send. The browser starts it right away; the scheduled job picks up anything left. */
export async function queueBulk(orgId: string, userId: string, b: SendInput) {
  const task = await enqueue(orgId, 'messages.bulk', { ...b, userId }, userId);
  await db.backgroundTask.updateMany({ where: { id: task.id }, data: { progress: { sent: 0, skipped: 0, failed: 0, total: b.recipientIds.length, done: [] } } });
  return task;
}

registerTask('messages.bulk', async ({ task, deadline, progress }: TaskCtx) => {
  const p = task.payload as SendInput & { userId: string };
  const [org, m] = await Promise.all([
    db.organization.findUnique({ where: { id: task.organizationId } }),
    db.membership.findFirst({ where: { organizationId: task.organizationId, userId: p.userId }, include: { user: true } }),
  ]);
  if (!org || !m || m.role === 'VIEWER') throw new Error('The person who queued this send is no longer on the team.');
  if (!['trialing', 'active'].includes(org.subscriptionStatus)) throw new Error('The subscription is inactive.');
  const prev = (task.progress ?? { sent: 0, skipped: 0, failed: 0, total: p.recipientIds.length, done: [] }) as Progress;
  const done = new Set(prev.done);
  const t = await sendBulk(org, m.user, p, {
    skip: done, deadline, start: prev,
    after: async (id, tally) => { done.add(id); await progress({ ...tally, total: prev.total, done: [...done] }); },
  });
  await logActivity(org.id, summary(p, t), m.userId);
  return { ...t };
});

/** How many on a list can be emailed or texted (for the "Message this list" drawer). */
export const reachOf = (rows: { email: string | null; phone: string | null; emailOptOut?: boolean; smsOptOut?: boolean }[]) => ({
  total: rows.length, email: rows.filter((r) => r.email && !r.emailOptOut).length, sms: rows.filter((r) => r.phone && !r.smsOptOut).length,
});
