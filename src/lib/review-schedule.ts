import { z } from 'zod';
import type { Organization } from '@prisma/client';
import { db } from './db';
import { HttpError, tenantDb, type TenantDb } from './tenant';
import { hasFeature } from './plans';
import { sendEmail } from './email';
import { localDate } from './timeclock';
import { DEFAULT_QUESTIONS } from './reviews';

/**
 * Review schedules. Each employee is reviewed annually or semi-annually (or not at all) — on their work anniversary
 * or in fixed calendar months. A daily job adds each review to the Reviews page ahead of its due date and reminds the
 * employee's manager, by email and as a task, until the manager review is written.
 */
export const FREQUENCIES = { ANNUAL: 'Annual', SEMIANNUAL: 'Semi-annual', NONE: 'No scheduled reviews' } as const;
export type Frequency = keyof typeof FREQUENCIES;
export const BASES = { HIRE_DATE: 'On each work anniversary', CALENDAR: 'In fixed months for everyone' } as const;
export type Basis = keyof typeof BASES;
/** Reminders go out this many days before the due date (negative: days overdue). One per stage, so a missed day catches up once. */
export const REMINDER_DAYS = [30, 14, 7, 1, 0, -7, -14, -21, -28] as const;
/** People who started this recently skip a calendar-month review; their first comes at the next one. */
export const NEW_HIRE_GRACE_DAYS = 90;

const toDay = (s: string) => Date.parse(`${s}T00:00:00Z`) / 864e5;
export const daysBetween = (from: string, to: string) => Math.round(toDay(to) - toDay(from));
export const addDaysYmd = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
/** The same day `months` later, kept inside the month (Jan 31 + 1 month is Feb 28/29). */
export function addMonthsYmd(s: string, months: number) {
  const [y, m, d] = s.split('-').map(Number);
  const t = y * 12 + (m - 1) + months, ny = Math.floor(t / 12), nm = (t % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, lastDay(ny, nm))).padStart(2, '0')}`;
}
export const monthsFor = (f: Frequency) => (f === 'SEMIANNUAL' ? 6 : 12);

/**
 * The first review due date after `after` (YYYY-MM-DD). Work anniversary: every 6 or 12 months from the start date.
 * Calendar: the last day of the review month (and six months later for semi-annual), skipping one that falls within
 * NEW_HIRE_GRACE_DAYS of the start date.
 */
export function nextDue(o: { startDate: string; frequency: Frequency; basis: Basis; month: number; after: string }): string | null {
  if (o.frequency === 'NONE') return null;
  const step = monthsFor(o.frequency);
  if (o.basis === 'HIRE_DATE') {
    // Jump close to `after`, then step forward.
    const gap = Math.max(0, Math.floor((toDay(o.after) - toDay(o.startDate)) / 30.44 / step) - 1);
    for (let k = Math.max(1, gap); k < gap + 40; k++) {
      const d = addMonthsYmd(o.startDate, k * step);
      if (d > o.after) return d;
    }
    return null;
  }
  const months = o.frequency === 'SEMIANNUAL' ? [o.month, ((o.month + 5) % 12) + 1] : [o.month];
  const [ay] = o.after.split('-').map(Number);
  const candidates = [ay - 1, ay, ay + 1, ay + 2].flatMap((y) => months.map((m) => `${y}-${String(m).padStart(2, '0')}-${String(lastDay(y, m)).padStart(2, '0')}`)).sort();
  return candidates.find((d) => d > o.after && daysBetween(o.startDate, d) >= NEW_HIRE_GRACE_DAYS) ?? null;
}

/** The reminder stage a review should be at with `daysLeft` until it's due, or null if nothing new is due. */
export function nextStage(daysLeft: number, current: number) {
  let s = current;
  for (let i = current + 1; i < REMINDER_DAYS.length; i++) if (daysLeft <= REMINDER_DAYS[i]) s = i;
  return s > current ? s : null;
}

export const when = (daysLeft: number) => (daysLeft > 1 ? `due in ${daysLeft} days` : daysLeft === 1 ? 'due tomorrow' : daysLeft === 0 ? 'due today' : `${-daysLeft} day${daysLeft === -1 ? '' : 's'} overdue`);
const fmt = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);

export const ScheduleBody = z.object({
  reviewScheduleOn: z.boolean().optional(),
  reviewFrequency: z.enum(['ANNUAL', 'SEMIANNUAL', 'NONE'], { errorMap: () => ({ message: 'Choose how often people are reviewed.' }) }).optional(),
  reviewBasis: z.enum(['HIRE_DATE', 'CALENDAR'], { errorMap: () => ({ message: 'Choose when reviews fall due.' }) }).optional(),
  reviewMonth: z.number().int().min(1, 'Choose a month.').max(12, 'Choose a month.').optional(),
  reviewLeadDays: z.number().int().min(7, 'Add reviews at least 7 days ahead.').max(90, 'Add reviews at most 90 days ahead.').optional(),
}).strict();

type Emp = { id: string; startDate: Date; reviewFrequency: string | null; title: string; managerId: string | null; candidate: { name: string } };
export const frequencyOf = (org: Pick<Organization, 'reviewFrequency'>, e: Pick<Emp, 'reviewFrequency'>) => (e.reviewFrequency ?? org.reviewFrequency) as Frequency;

/** Everyone's next review over the coming `days`, for the Reviews page — whether or not it's been added yet. */
export async function upcoming(tdb: TenantDb, org: Organization, today: string, days = 90) {
  const people = await tdb.employee.findMany({ where: { status: { not: 'TERMINATED' } }, include: { candidate: { select: { name: true } }, manager: { include: { candidate: { select: { name: true } } } },
    reviews: { where: { cycle: { auto: { not: null } } }, select: { dueDate: true, managerSubmittedAt: true, id: true }, orderBy: { dueDate: 'desc' }, take: 1 } } });
  // Someone already in an unfinished review that HR started by hand isn't given a second one.
  const busy = new Map((await tdb.review.findMany({ where: { managerSubmittedAt: null, cycle: { status: 'OPEN', auto: null } }, select: { employeeId: true, cycle: { select: { name: true } } } })).map((r) => [r.employeeId, r.cycle.name]));
  const out: { employeeId: string; name: string; title: string; manager: string | null; frequency: Frequency; due: string; daysLeft: number; reviewId: string | null; inCycle: string | null }[] = [];
  for (const e of people) {
    const frequency = frequencyOf(org, e);
    if (frequency === 'NONE') continue;
    const last = e.reviews[0];
    // A scheduled review that's still open is the next one; otherwise work out the next due date.
    const open = last?.dueDate && !last.managerSubmittedAt ? ymd(last.dueDate) : null;
    const due = open ?? nextDue({ startDate: ymd(e.startDate), frequency, basis: org.reviewBasis as Basis, month: org.reviewMonth, after: last?.dueDate ? ymd(last.dueDate) : addDaysYmd(today, -1) });
    if (!due || daysBetween(today, due) > days) continue;
    out.push({ employeeId: e.id, name: e.candidate.name, title: e.title, manager: e.manager?.candidate.name ?? null, frequency, due, daysLeft: daysBetween(today, due), reviewId: open ? last!.id : null, inCycle: open ? null : busy.get(e.id) ?? null });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name));
}

/** The review cycle that holds scheduled reviews of this kind due in this month (made on first use). */
async function cycleFor(tdb: TenantDb, frequency: Exclude<Frequency, 'NONE'>, due: string) {
  const [y, m] = due.split('-').map(Number);
  const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay(y, m)).padStart(2, '0')}`;
  const name = `${frequency === 'ANNUAL' ? 'Annual' : 'Semi-annual'} reviews · ${new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
  const found = await tdb.reviewCycle.findFirst({ where: { auto: frequency, dueDate: day(monthEnd), status: 'OPEN' } });
  if (found) return found;
  return tdb.reviewCycle.create({ data: {
    name, auto: frequency, periodStart: day(addMonthsYmd(`${y}-${String(m).padStart(2, '0')}-01`, -monthsFor(frequency))), periodEnd: day(monthEnd), dueDate: day(monthEnd),
    selfReview: true, questions: DEFAULT_QUESTIONS,
  } as never });
}

/** Adds the reviews that are now within the lead time. Returns how many were added. */
export async function scheduleReviews(tdb: TenantDb, org: Organization, today: string) {
  const horizon = addDaysYmd(today, org.reviewLeadDays);
  let added = 0;
  for (const u of await upcoming(tdb, org, today, org.reviewLeadDays)) {
    if (u.reviewId || u.inCycle || u.due > horizon || u.frequency === 'NONE') continue;
    const c = await cycleFor(tdb, u.frequency, u.due);
    const r = await tdb.review.createMany({ data: [{ organizationId: org.id, cycleId: c.id, employeeId: u.employeeId, dueDate: day(u.due) }], skipDuplicates: true });
    added += r.count;
  }
  return added;
}

type Due = { reviewId: string; employee: string; title: string; kind: string; due: string; daysLeft: number; managerName: string | null };
type Recipient = { email: string; name: string; userId: string | null; relatedType: string; relatedId: string; items: Due[] };

export function digest(company: string, r: Pick<Recipient, 'name' | 'items' | 'userId'>, appUrl: string, forHr: boolean) {
  const overdue = r.items.filter((i) => i.daysLeft < 0).length;
  const subject = `${r.items.length} performance review${r.items.length === 1 ? '' : 's'} ${overdue ? `need${r.items.length === 1 ? 's' : ''} attention (${overdue} overdue)` : 'coming due'}`;
  const lines = r.items.map((i) => `- ${i.employee}, ${i.title}: ${i.kind} ${when(i.daysLeft)} (${fmt(i.due)})${forHr ? ` — ${i.managerName ? `manager ${i.managerName} has no email on file or no Preciops account under it` : 'no manager set'}` : ''}`);
  const how = r.userId
    ? `Write and share each review in Preciops:\n${appUrl}/app/reviews`
    : `Write and share each review in Preciops (${appUrl}/app/reviews). If you don’t have an account under this email address, ask HR to set one up — or send them your notes and they’ll enter the review.`;
  const text = [`Hi ${r.name.split(' ')[0] || 'there'},`, '', forHr ? 'These performance reviews have no manager who can write them in Preciops, so they’re with you:' : 'Performance reviews for your team are coming due:', '', ...lines, '',
    'Each employee also answers a self review on their own page, which you’ll see before you write yours.', '', how, '', company].join('\n');
  return { subject, text };
}

/**
 * Daily: adds reviews coming due, and sends each manager one email listing their reports' reviews that reached a
 * new reminder stage (plus a task in Preciops if they have an account). Reviews with no reachable manager go to HR.
 */
export async function runReviewReminders(now = new Date(), appUrl = process.env.APP_URL ?? 'http://localhost:3000') {
  const orgs = await db.organization.findMany({ where: { reviewScheduleOn: true, subscriptionStatus: { in: ['trialing', 'active'] } } });
  let added = 0, emails = 0, reminded = 0;
  for (const org of orgs) {
    if (!hasFeature(org, 'reviews')) continue;
    const tdb = tenantDb(org.id), today = localDate(now, org.timezone);
    added += await scheduleReviews(tdb, org, today);
    // Tasks for reviews that were written close themselves.
    const doneIds = (await tdb.review.findMany({ where: { managerSubmittedAt: { not: null }, reminderStage: { gte: 0 } }, select: { id: true } })).map((r) => `review:${r.id}`);
    if (doneIds.length) await tdb.task.updateMany({ where: { related: { in: doneIds }, done: false }, data: { done: true } });

    const open = await tdb.review.findMany({ where: { managerSubmittedAt: null, cycle: { status: 'OPEN' }, employee: { status: { not: 'TERMINATED' } } },
      include: { cycle: true, employee: { include: { candidate: { select: { name: true } }, manager: { include: { candidate: { select: { name: true, email: true, emailOptOut: true } } } } } } } });
    // Managers with an account that can write reviews (viewers can't).
    const members = await db.membership.findMany({ where: { organizationId: org.id, role: { not: 'VIEWER' } }, include: { user: { select: { id: true, email: true, name: true } } } });
    const userByEmail = new Map(members.map((m) => [m.user.email.toLowerCase(), m.user]));
    const hr = members.filter((m) => m.role === 'OWNER' || m.role === 'ADMIN').map((m) => m.user);
    const to = new Map<string, Recipient>(), stages = new Map<string, number>();
    for (const r of open) {
      const due = ymd(r.dueDate ?? r.cycle.dueDate), daysLeft = daysBetween(today, due);
      if (daysLeft > org.reviewLeadDays) continue;
      const stage = nextStage(daysLeft, r.reminderStage);
      if (stage === null) continue;
      stages.set(r.id, stage);
      const m = r.employee.manager;
      const item: Due = { reviewId: r.id, employee: r.employee.candidate.name, title: r.employee.title, kind: r.cycle.auto ? (r.cycle.auto === 'ANNUAL' ? 'annual review' : 'semi-annual review') : r.cycle.name, due, daysLeft, managerName: m?.candidate.name ?? null };
      const email = m && m.status !== 'TERMINATED' && !m.candidate.emailOptOut ? (m.workEmail ?? m.candidate.email) : null;
      const user = m ? (m.workEmail && userByEmail.get(m.workEmail.toLowerCase())) || (m.candidate.email && userByEmail.get(m.candidate.email.toLowerCase())) || null : null;
      if (email) {
        const key = email.toLowerCase();
        const rec = to.get(key) ?? { email, name: m!.candidate.name, userId: user ? user.id : null, relatedType: 'employee', relatedId: m!.id, items: [] };
        rec.items.push(item); to.set(key, rec);
      }
      // HR hears about reviews nobody else can act on: no manager, no email, or a manager with no account to write it in.
      if (!email || !user) for (const h of hr) {
        const key = `hr:${h.email.toLowerCase()}`;
        const rec = to.get(key) ?? { email: h.email, name: h.name ?? '', userId: h.id, relatedType: 'user', relatedId: h.id, items: [] };
        rec.items.push(item); to.set(key, rec);
      }
    }
    const delivered = new Set<string>();
    for (const [key, rec] of to) {
      rec.items.sort((a, b) => a.daysLeft - b.daysLeft);
      const { subject, text } = digest(org.shortName ?? org.name, rec, appUrl, key.startsWith('hr:'));
      let status = 'sent', providerId: string | null = null, error: string | null = null;
      try { providerId = (await sendEmail({ to: rec.email, subject, text, fromName: org.shortName ?? org.name })).id; emails++; rec.items.forEach((i) => delivered.add(i.reviewId)); }
      catch (e) { status = 'failed'; error = (e as Error).message.slice(0, 500); }
      await tdb.message.create({ data: { channel: 'email', toAddress: rec.email, subject, body: text, relatedType: rec.relatedType, relatedId: rec.relatedId, status, providerId, error } as never });
      // A task in Preciops too, one per review, kept up to date.
      if (rec.userId && !key.startsWith('hr:')) for (const i of rec.items) {
        const related = `review:${i.reviewId}`, title = `Write ${i.employee}’s ${i.kind}`;
        const t = await tdb.task.findFirst({ where: { related, assigneeId: rec.userId } });
        if (t) await tdb.task.updateMany({ where: { id: t.id }, data: { dueAt: day(i.due), priority: i.daysLeft <= 7 ? 'High' : 'Normal', done: false } });
        else await tdb.task.create({ data: { title, related, assigneeId: rec.userId, dueAt: day(i.due), priority: i.daysLeft <= 7 ? 'High' : 'Normal' } as never });
      }
    }
    // Move a review to its new stage once someone got the email (or there was nobody to send to), so a mail outage retries tomorrow.
    for (const [id, stage] of stages) {
      const anyone = [...to.values()].some((rec) => rec.items.some((i) => i.reviewId === id));
      if (delivered.has(id) || !anyone) { await tdb.review.updateMany({ where: { id }, data: { reminderStage: stage, lastRemindedAt: now } }); reminded++; }
    }
  }
  return { added, emails, reminded };
}

/** Saves the company's review schedule (admins). */
export async function saveSchedule(orgId: string, body: unknown) {
  const r = ScheduleBody.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Check the review schedule.');
  return db.organization.update({ where: { id: orgId }, data: r.data });
}
