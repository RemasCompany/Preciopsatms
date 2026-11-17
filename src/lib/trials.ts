import { db } from './db';
import { tenantDb } from './tenant';
import { sendEmail } from './email';

/**
 * The free trial's end, for companies that never chose a plan (no Stripe subscription; Stripe runs card trials itself).
 * The owners get an email 3 days and 1 day before it ends. When it ends the company becomes read-only
 * ("trial_expired"): nothing is deleted, and choosing a plan on Billing turns everything back on.
 * Complimentary companies are left alone. Every email is logged.
 */
export const NOTICES = [{ days: 3, stage: 0 }, { days: 1, stage: 1 }] as const;
export const ENDED = 2;

const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';
const fmt = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

export function trialEmail(company: string, stage: number, endsAt: Date, now = new Date()) {
  const billing = `${appUrl()}/app/billing`;
  if (stage === ENDED) return {
    subject: `Your Preciops trial for ${company} has ended`,
    text: [`Your 14-day free trial for ${company} ended on ${fmt(endsAt)}.`, '',
      'Your account is now read-only. Everything you added is safe: jobs, candidates, employees, schedules, timesheets and documents.',
      `Choose a plan to pick up where you left off: ${billing}`, '', 'Questions? Just reply to this email.', '', '— The Preciops team'].join('\n'),
  };
  // The days actually left (an extended or late-checked trial may not be exactly 3 or 1).
  const n = Math.max(1, Math.ceil((endsAt.getTime() - now.getTime()) / 864e5));
  return {
    subject: `${n} day${n === 1 ? '' : 's'} left in your Preciops trial`,
    text: [`Your free trial for ${company} ends ${n === 1 ? 'tomorrow,' : 'on'} ${fmt(endsAt)}.`, '',
      `Choose a plan to keep everything running without a break: ${billing}`,
      'If you don’t, your account becomes read-only when the trial ends. Nothing is deleted.', '', 'Questions? Just reply to this email.', '', '— The Preciops team'].join('\n'),
  };
}

/** Which notice is due now, if any: the trial ended, or it's within 1 or 3 days of ending and that email hasn't gone out. */
export function noticeDue(o: { trialEndsAt: Date; trialNotice: number }, now = new Date()) {
  const ms = o.trialEndsAt.getTime() - now.getTime();
  if (ms <= 0) return o.trialNotice < ENDED ? ENDED : null;
  // The most urgent notice wins, so a trial extended to 2 days doesn't get the "3 days" email.
  const due = [...NOTICES].reverse().find((n) => ms <= n.days * 864e5);
  return due && o.trialNotice < due.stage ? due.stage : null;
}

export async function runTrialLifecycle(now = new Date()) {
  const orgs = await db.organization.findMany({
    where: { stripeSubscriptionId: null, complimentary: false, trialEndsAt: { not: null }, OR: [{ subscriptionStatus: 'trialing' }, { subscriptionStatus: 'trial_expired', trialNotice: { lt: ENDED } }] },
    select: { id: true, name: true, subscriptionStatus: true, trialEndsAt: true, trialNotice: true },
  });
  let expired = 0, emailed = 0;
  for (const o of orgs) {
    const end = o.trialEndsAt!;
    if (end <= now && o.subscriptionStatus === 'trialing') {
      // Read-only from here; a guarded update so it can't undo a plan chosen a moment ago.
      const r = await db.organization.updateMany({ where: { id: o.id, subscriptionStatus: 'trialing', stripeSubscriptionId: null }, data: { subscriptionStatus: 'trial_expired' } });
      if (r.count) expired++;
    }
    const stage = noticeDue({ trialEndsAt: end, trialNotice: o.trialNotice }, now);
    if (stage === null) continue;
    const owners = await db.membership.findMany({ where: { organizationId: o.id, role: 'OWNER' }, select: { user: { select: { email: true } } } });
    const msg = trialEmail(o.name, stage, end, now);
    const tdb = tenantDb(o.id);
    let delivered = false;
    for (const { user } of owners) {
      let status = 'sent', providerId: string | null = null, error: string | null = null;
      try { providerId = (await sendEmail({ to: user.email, subject: msg.subject, text: msg.text, fromName: 'Preciops' })).id; delivered = true; emailed++; }
      catch (e) { status = 'failed'; error = (e as Error).message.slice(0, 500); }
      await tdb.message.create({ data: { channel: 'email', toAddress: user.email, subject: msg.subject, body: msg.text, relatedType: 'trial_notice', status, providerId, error } as never });
    }
    // Marked only when someone got it, so a mail outage tries again tomorrow.
    if (delivered) await db.organization.updateMany({ where: { id: o.id }, data: { trialNotice: stage } });
  }
  return { expired, emailed };
}
