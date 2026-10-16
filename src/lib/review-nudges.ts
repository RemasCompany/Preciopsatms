import type { Organization } from '@prisma/client';
import type { TenantDb } from './tenant';
import { sendEmail } from './email';
import { sendSms } from './sms';
import { newToken, sha256 } from './tokens';

/**
 * Reminders to employees: answer your self review, and read and acknowledge the review your manager shared. One
 * message per person (email, or a text when there's no email), honoring opt-outs, with a fresh private link to their
 * employee page where both are done.
 */
/** Self review: days before it's wanted (a week before the review is due, so the manager has it first). */
export const SELF_DAYS = [14, 7, 3, 1, 0, -3, -7] as const;
export const SELF_LEAD_DAYS = 7;
/** Acknowledgement: days since the manager shared the review. Day 0 is the "your review is ready" message. */
export const ACK_DAYS = [0, 3, 7, 14, 21] as const;

const toDay = (s: string) => Date.parse(`${s}T00:00:00Z`) / 864e5;
const between = (a: string, b: string) => Math.round(toDay(b) - toDay(a));
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => ymd(new Date(Date.parse(`${s}T00:00:00Z`) + n * 864e5));
const fmt = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';

/** The self-review stage to move to with `daysLeft` until it's wanted, or null. */
export function selfStage(daysLeft: number, current: number) {
  let s = current;
  for (let i = current + 1; i < SELF_DAYS.length; i++) if (daysLeft <= SELF_DAYS[i]) s = i;
  return s > current ? s : null;
}
/** The acknowledgement stage to move to `daysSince` the review was shared, or null. */
export function ackStage(daysSince: number, current: number) {
  let s = current;
  for (let i = current + 1; i < ACK_DAYS.length; i++) if (daysSince >= ACK_DAYS[i]) s = i;
  return s > current ? s : null;
}

type Item = { reviewId: string; kind: 'self' | 'ack'; cycle: string; wanted: string; days: number; stage: number };
type Person = { candidateId: string; name: string; email: string | null; phone: string | null; emailOptOut: boolean; smsOptOut: boolean };

export function employeeMessage(company: string, first: string, items: Item[], link: string) {
  const self = items.filter((i) => i.kind === 'self'), ack = items.filter((i) => i.kind === 'ack');
  const subject = ack.length && !self.length ? (ack.some((i) => i.stage === 0) ? 'Your performance review is ready to read' : 'Please acknowledge your performance review')
    : self.length && !ack.length ? (self.some((i) => i.days < 0) ? 'Your self review is overdue' : 'Please complete your self review') : 'Your performance reviews need you';
  const lines = [
    ...self.map((i) => `- Self review for ${i.cycle}: ${i.days > 1 ? `please finish it by ${fmt(i.wanted)} (${i.days} days)` : i.days === 1 ? `please finish it by tomorrow, ${fmt(i.wanted)}` : i.days === 0 ? 'please finish it today' : `it was due ${fmt(i.wanted)} — please finish it as soon as you can`}`),
    ...ack.map((i) => `- ${i.cycle}: your manager shared your review${i.stage === 0 ? '' : ` ${i.days} day${i.days === 1 ? '' : 's'} ago`}. Please read it and acknowledge it — you can add your own comments.`),
  ];
  const text = [`Hi ${first},`, '', ...lines, '', 'Open your employee page to do this:', link, '',
    ...(self.length ? ['Your self review helps your manager see the period from your side. It takes about 10 minutes.', ''] : []),
    ...(ack.length ? ['Acknowledging means you’ve read the review, not that you agree with all of it — use the comment box to say so.', ''] : []),
    'This link is just for you, so please don’t share it.', '', company].join('\n');
  const sms = `${company}: hi ${first}, ${self.length && ack.length ? 'your self review and your manager’s review need you' : self.length ? `please complete your self review${self[0].days >= 0 ? ` by ${fmt(self[0].wanted)}` : ' (overdue)'}` : 'your performance review is ready — please read and acknowledge it'}: ${link}`;
  return { subject, text, sms };
}

/** Sends one person their review reminders. Returns whether it reached them. */
async function deliver(tdb: TenantDb, org: Organization, p: Person, items: Item[], now: Date) {
  const email = !p.emailOptOut ? p.email : null, phone = !p.smsOptOut ? p.phone : null;
  if (!email && !phone) return false;
  // A fresh private link to their employee page, replacing the last review link.
  await tdb.workerLink.updateMany({ where: { candidateId: p.candidateId, kind: 'review', revokedAt: null }, data: { revokedAt: now } });
  const token = newToken();
  await tdb.workerLink.create({ data: { candidateId: p.candidateId, tokenHash: sha256(token), kind: 'review', expiresAt: new Date(now.getTime() + 30 * 864e5) } as never });
  const company = org.shortName ?? org.name, m = employeeMessage(company, p.name.split(' ')[0] || 'there', items, `${appUrl()}/shifts/${token}`);
  let status = 'sent', providerId: string | null = null, error: string | null = null;
  try {
    providerId = email ? (await sendEmail({ to: email, subject: m.subject, text: m.text, fromName: company })).id : (await sendSms(phone!, m.sms)).id;
  } catch (e) { status = 'failed'; error = (e as Error).message.slice(0, 500); }
  await tdb.message.create({ data: { channel: email ? 'email' : 'sms', toAddress: email ?? phone!, subject: email ? m.subject : null, body: email ? m.text : m.sms, relatedType: 'candidate', relatedId: p.candidateId, status, providerId, error } as never });
  return status === 'sent';
}

const PERSON = { candidate: { select: { id: true, name: true, email: true, phone: true, emailOptOut: true, smsOptOut: true } } } as const;
type Emp = { workEmail: string | null; candidate: { id: string; name: string; email: string | null; phone: string | null; emailOptOut: boolean; smsOptOut: boolean } };
const person = (e: Emp): Person => ({ candidateId: e.candidate.id, name: e.candidate.name, email: e.candidate.email ?? e.workEmail, phone: e.candidate.phone, emailOptOut: e.candidate.emailOptOut, smsOptOut: e.candidate.smsOptOut });

/** Daily: self-review and acknowledgement reminders that reached a new stage, one message per employee. */
export async function remindEmployees(tdb: TenantDb, org: Organization, today: string, now = new Date()) {
  const reviews = await tdb.review.findMany({
    where: { cycle: { status: 'OPEN' }, employee: { status: { not: 'TERMINATED' } }, OR: [{ selfSubmittedAt: null, sharedAt: null, cycle: { selfReview: true } }, { sharedAt: { not: null }, acknowledgedAt: null }] },
    include: { cycle: true, employee: { include: PERSON } },
  });
  const by = new Map<string, { p: Person; items: Item[] }>();
  for (const r of reviews) {
    let item: Item | null = null;
    if (r.sharedAt && !r.acknowledgedAt) {
      const days = between(ymd(r.sharedAt), today), stage = ackStage(days, r.ackReminderStage);
      if (stage !== null) item = { reviewId: r.id, kind: 'ack', cycle: r.cycle.name, wanted: ymd(r.sharedAt), days, stage };
    } else if (!r.selfSubmittedAt) {
      const wanted = addDays(ymd(r.dueDate ?? r.cycle.dueDate), -SELF_LEAD_DAYS), days = between(today, wanted), stage = selfStage(days, r.selfReminderStage);
      if (stage !== null) item = { reviewId: r.id, kind: 'self', cycle: r.cycle.name, wanted, days, stage };
    }
    if (!item) continue;
    const p = person(r.employee);
    const g = by.get(p.candidateId) ?? { p, items: [] };
    g.items.push(item); by.set(p.candidateId, g);
  }
  let sent = 0;
  for (const { p, items } of by.values()) {
    const ok = await deliver(tdb, org, p, items, now);
    if (ok) sent++;
    // Advance once delivered — or when there's no way to reach them, so they aren't retried every day (HR sees it on the Reviews page).
    const reachable = (!p.emailOptOut && p.email) || (!p.smsOptOut && p.phone);
    if (ok || !reachable) for (const i of items) await tdb.review.updateMany({ where: { id: i.reviewId }, data: i.kind === 'self' ? { selfReminderStage: i.stage } : { ackReminderStage: i.stage } });
  }
  return sent;
}

/** Right after a manager shares a review: tell the employee it's ready (the day-0 acknowledgement message). */
export async function notifyShared(tdb: TenantDb, org: Organization, reviewId: string, now = new Date()) {
  if (!org.reviewScheduleOn || !org.reviewRemindEmployees) return false;
  const r = await tdb.review.findFirst({ where: { id: reviewId }, include: { cycle: true, employee: { include: PERSON } } });
  if (!r || !r.sharedAt || r.acknowledgedAt || r.ackReminderStage >= 0) return false;
  const p = person(r.employee);
  const ok = await deliver(tdb, org, p, [{ reviewId: r.id, kind: 'ack', cycle: r.cycle.name, wanted: ymd(r.sharedAt), days: 0, stage: 0 }], now);
  if (ok) await tdb.review.updateMany({ where: { id: r.id }, data: { ackReminderStage: 0 } });
  return ok;
}
