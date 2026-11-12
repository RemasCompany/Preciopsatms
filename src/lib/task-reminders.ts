import { db } from './db';
import { tenantDb } from './tenant';
import { sendEmail } from './email';
import { deliver } from './schedule-server';

/**
 * Task reminders and follow-ups (daily). Before a task is due its owner gets a reminder; once it's overdue and still
 * open it resurfaces every few days until it's done. One merged email per person; every attempt is logged. Tasks with
 * no owner go to the company's owners and admins; tasks assigned to an employee go to that employee (honoring opt-outs).
 */
export const SOON_MS = 2 * 864e5; // "due soon" = within two days
export const FOLLOW_UP_MS = 3 * 864e5; // an overdue task comes back every three days
export const GIVE_UP_MS = 60 * 864e5; // …for up to 60 days past due

type T = { id: string; title: string; dueAt: Date | null; priority: string; remindedAt: Date | null; followedUpAt: Date | null };

/** Which open tasks need a word today: due soon (not yet reminded for this due date) or overdue (not followed up lately). */
export function dueForReminder(tasks: T[], now = new Date()) {
  const t0 = now.getTime();
  const soon: T[] = [], overdue: T[] = [];
  for (const t of tasks) {
    if (!t.dueAt) continue;
    const due = t.dueAt.getTime();
    if (due >= t0 && due - t0 <= SOON_MS) {
      // A reminder sent for an earlier due date doesn't count once the date moves.
      if (!t.remindedAt || t.remindedAt.getTime() < due - SOON_MS) soon.push(t);
    } else if (due < t0 && t0 - due <= GIVE_UP_MS) {
      if (!t.followedUpAt || t0 - t.followedUpAt.getTime() >= FOLLOW_UP_MS - 3600e3) overdue.push(t);
    }
  }
  const byPriority = (a: T, b: T) => (a.priority === 'High' ? 0 : 1) - (b.priority === 'High' ? 0 : 1) || a.dueAt!.getTime() - b.dueAt!.getTime();
  return { soon: soon.sort(byPriority), overdue: overdue.sort(byPriority) };
}

const day = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const line = (t: T) => `• ${t.priority === 'High' ? '[High] ' : ''}${t.title} — due ${day(t.dueAt!)}`;

export function reminderEmail(company: string, who: string, soon: T[], overdue: T[], link: string | null) {
  const subject = overdue.length
    ? `${overdue.length} overdue task${overdue.length === 1 ? '' : 's'}${soon.length ? `, ${soon.length} due soon` : ''}`
    : `${soon.length} task${soon.length === 1 ? '' : 's'} due soon`;
  const text = [
    `Hi ${who || 'there'},`, '',
    ...(overdue.length ? ['OVERDUE — still open:', ...overdue.map(line), ''] : []),
    ...(soon.length ? ['DUE SOON:', ...soon.map(line), ''] : []),
    ...(link ? [`Open your tasks: ${link}`, ''] : []),
    `Overdue tasks come back every ${FOLLOW_UP_MS / 864e5} days until they’re done. — ${company}`,
  ].join('\n');
  return { subject, text };
}

export async function runTaskReminders(now = new Date(), appUrl = process.env.APP_URL ?? 'http://localhost:3000') {
  const orgs = await db.organization.findMany({ where: { subscriptionStatus: { in: ['trialing', 'active'] } }, select: { id: true, name: true, shortName: true, applyEmail: true } });
  let people = 0, tasks = 0;
  for (const org of orgs) {
    const tdb = tenantDb(org.id);
    const open = await tdb.task.findMany({
      where: { done: false, dueAt: { not: null, gte: new Date(now.getTime() - GIVE_UP_MS), lte: new Date(now.getTime() + SOON_MS) } },
      select: { id: true, title: true, dueAt: true, priority: true, remindedAt: true, followedUpAt: true, assigneeId: true, employeeId: true },
    });
    if (!open.length) continue;
    const company = org.shortName ?? org.name;
    // Group by who should hear about it.
    const groups = new Map<string, typeof open>();
    for (const t of open) {
      const key = t.employeeId ? `e:${t.employeeId}` : t.assigneeId ? `u:${t.assigneeId}` : 'admins';
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    let admins: { id: string; email: string; name: string | null }[] | null = null;
    for (const [key, list] of groups) {
      const { soon, overdue } = dueForReminder(list, now);
      if (!soon.length && !overdue.length) continue;
      let delivered = false;
      if (key.startsWith('e:')) {
        const e = await tdb.employee.findFirst({ where: { id: key.slice(2), status: { not: 'TERMINATED' } }, select: { candidate: { select: { id: true, name: true, email: true, phone: true, emailOptOut: true, smsOptOut: true } } } });
        if (e) {
          const msg = reminderEmail(company, e.candidate.name.split(' ')[0], soon, overdue, null);
          delivered = !(await deliver(tdb, e.candidate, e.candidate.email ? 'email' : 'sms', { subject: msg.subject, text: `${msg.text}\nYou’ll find them on your employee page.` }, { name: company, replyTo: org.applyEmail ?? undefined }, null));
        }
      } else {
        const to = key === 'admins'
          ? (admins ??= (await db.membership.findMany({ where: { organizationId: org.id, role: { in: ['OWNER', 'ADMIN'] } }, select: { user: { select: { id: true, email: true, name: true } } } })).map((m) => m.user))
          : (await db.membership.findMany({ where: { organizationId: org.id, userId: key.slice(2) }, select: { user: { select: { id: true, email: true, name: true } } } })).map((m) => m.user);
        for (const u of to) {
          const msg = reminderEmail(company, (u.name ?? '').split(' ')[0], soon, overdue, `${appUrl}/app/tasks`);
          const subject = key === 'admins' ? `${msg.subject} (no one assigned)` : msg.subject;
          let status = 'sent', providerId: string | null = null, error: string | null = null;
          try { providerId = (await sendEmail({ to: u.email, subject, text: msg.text, fromName: company })).id; delivered = true; }
          catch (e) { status = 'failed'; error = (e as Error).message.slice(0, 500); }
          await tdb.message.create({ data: { channel: 'email', toAddress: u.email, subject, body: msg.text, relatedType: 'task_reminder', status, providerId, error } as never });
        }
      }
      // Only marked when someone got it, so a mail outage tries again tomorrow.
      if (!delivered) continue;
      people++; tasks += soon.length + overdue.length;
      if (soon.length) await tdb.task.updateMany({ where: { id: { in: soon.map((t) => t.id) } }, data: { remindedAt: now } });
      if (overdue.length) await tdb.task.updateMany({ where: { id: { in: overdue.map((t) => t.id) } }, data: { followedUpAt: now } });
    }
  }
  return { people, tasks };
}
