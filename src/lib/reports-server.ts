import { z } from 'zod';
import type { Organization, Role, User } from '@prisma/client';
import { db } from './db';
import { HttpError, logActivity, tenantDb } from './tenant';
import { hasFeature } from './plans';
import { toCsv } from './csv';
import { sendEmail } from './email';
import { localDate } from './timeclock';
import { REPORTS, isReport, previousPeriod, tableCsv, type ReportKey } from './reports';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isAdmin = (r: Role) => r === 'OWNER' || r === 'ADMIN';

/** Whether this person may run this report (money reports: owners and admins; they also need timesheets). */
export function mayRun(org: Organization, role: Role, key: ReportKey) {
  if (REPORTS[key].admin && !isAdmin(role)) return false;
  if ((key === 'margin' || key === 'hours') && !hasFeature(org, 'timesheets')) return false;
  return true;
}

export async function runReport(org: Organization, role: Role, key: string, q: { from?: string | null; to?: string | null; branch?: string | null }) {
  if (!isReport(key)) throw new HttpError(404, 'That report doesn’t exist.');
  if (!mayRun(org, role, key)) throw new HttpError(403, 'Only owners and admins can see this report.');
  if (!q.from || !q.to || !DAY.test(q.from) || !DAY.test(q.to)) throw new HttpError(400, 'Choose a date range.');
  if (q.from > q.to) throw new HttpError(400, 'The start date is after the end date.');
  if (Date.parse(q.to) - Date.parse(q.from) > 3 * 366 * 864e5) throw new HttpError(400, 'Choose up to three years at a time.');
  const tdb = tenantDb(org.id);
  const branch = q.branch && q.branch !== 'all' ? await tdb.branch.findFirst({ where: { id: q.branch }, select: { id: true } }) : null;
  return REPORTS[key].run({ tdb, range: { from: q.from, to: q.to }, branchId: branch?.id ?? null });
}

export const ScheduleBody = z.object({
  report: z.string().refine(isReport, 'Choose a report.'),
  frequency: z.enum(['weekly', 'monthly'], { errorMap: () => ({ message: 'Choose weekly or monthly.' }) }),
  userIds: z.array(z.string()).min(1, 'Choose who gets it.').max(50),
  branchId: z.string().nullable().optional(),
});

export async function createSchedule(org: Organization, user: User, b: z.infer<typeof ScheduleBody>) {
  const tdb = tenantDb(org.id);
  const members = await db.membership.findMany({ where: { organizationId: org.id, userId: { in: b.userIds } }, select: { userId: true, role: true } });
  if (members.length !== new Set(b.userIds).size) throw new HttpError(400, 'Everyone who gets a report must be on your team.');
  if (REPORTS[b.report as ReportKey].admin && members.some((m) => !isAdmin(m.role))) throw new HttpError(400, 'This report has pay and margin figures, so only owners and admins can get it.');
  if (b.branchId && !(await tdb.branch.findFirst({ where: { id: b.branchId } }))) throw new HttpError(404, 'That branch was deleted.');
  const s = await tdb.reportSchedule.create({ data: { report: b.report, frequency: b.frequency, userIds: [...new Set(b.userIds)], branchId: b.branchId ?? null, createdById: user.id } as never });
  await logActivity(org.id, `Scheduled the ${REPORTS[b.report as ReportKey].title} report ${b.frequency}`, user.id);
  return s;
}

/** Daily job: send weekly schedules on Mondays and monthly ones on the 1st (company time), once per day each. */
export async function runScheduledReports(now = new Date()) {
  const due = await db.reportSchedule.findMany({ include: { organization: true } });
  let sent = 0;
  for (const s of due) {
    const org = s.organization;
    if (!['trialing', 'active'].includes(org.subscriptionStatus) || !isReport(s.report)) continue;
    const today = localDate(now, org.timezone), d = new Date(`${today}T00:00:00Z`);
    const isDue = s.frequency === 'monthly' ? d.getUTCDate() === 1 : d.getUTCDay() === 1;
    if (!isDue || s.lastSentOn === today) continue;
    const range = previousPeriod(s.frequency as 'weekly' | 'monthly', today);
    // Recipients are re-checked every time: people who left the team, or lost admin, stop getting it.
    const members = await db.membership.findMany({ where: { organizationId: org.id, userId: { in: s.userIds } }, include: { user: { select: { email: true, name: true } } } });
    const allowed = members.filter((m) => mayRun(org, m.role, s.report as ReportKey));
    await db.reportSchedule.updateMany({ where: { id: s.id }, data: { lastSentOn: today } });
    if (!allowed.length) continue;
    const r = REPORTS[s.report as ReportKey];
    const t = await r.run({ tdb: tenantDb(org.id), range, branchId: s.branchId });
    const csv = Buffer.from(toCsv(tableCsv(t)));
    const branch = s.branchId ? (await tenantDb(org.id).branch.findFirst({ where: { id: s.branchId }, select: { name: true } }))?.name : null;
    const title = `${r.title}${branch ? ` — ${branch}` : ''}, ${range.from} to ${range.to}`;
    for (const m of allowed) {
      await sendEmail({ to: m.user.email, fromName: org.shortName ?? org.name, subject: `${org.shortName ?? org.name}: ${title}`,
        text: `Hi ${m.user.name?.split(' ')[0] ?? 'there'},\n\nYour ${s.frequency} ${r.title.toLowerCase()} report is attached (${t.rows.length} row${t.rows.length === 1 ? '' : 's'}).${t.note ? `\n\n${t.note}` : ''}\n\nChange or stop it on the Reports page.\n\nPreciops`,
        attachments: [{ filename: `${s.report}-${range.from}-to-${range.to}.csv`, content: csv }] }).then(() => sent++).catch((e) => console.error('[reports] email failed', e));
    }
  }
  return { sent };
}
