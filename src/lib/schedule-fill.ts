import { Prisma } from '@prisma/client';
import type { TenantDb } from './tenant';
import { shiftHours } from './schedule';
import { ymd } from './weeks';
import { weekRange } from './timeclock-server';

const WEEKLY_OT = 40;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Scheduled hours per assignment for one week; anything past 40 in the week is overtime (FLSA weekly rule). */
export function scheduledHours(shifts: { applicationId: string; start: string; end: string; breakMinutes: number }[]) {
  const total = new Map<string, number>();
  for (const s of shifts) total.set(s.applicationId, (total.get(s.applicationId) ?? 0) + shiftHours(s));
  return [...total].map(([applicationId, h]) => ({ applicationId, regularHours: r2(Math.min(h, WEEKLY_OT)), overtimeHours: r2(Math.max(0, h - WEEKLY_OT)) }));
}

/**
 * Pre-fills the week's timesheets from the schedule: shifts that aren't cancelled or declined.
 * Never overwrites hours someone typed, time-clock punches, or approved/paid timesheets — it only fills blanks.
 */
export async function fillFromSchedule(tdb: TenantDb, weekEnding: Date, tz: string) {
  const start = new Date(weekEnding); start.setUTCDate(start.getUTCDate() - 6);
  const shifts = await tdb.shift.findMany({ where: { date: { gte: start, lte: weekEnding }, cancelled: false, response: { not: 'DECLINED' } },
    include: { application: { include: { candidate: { select: { name: true } }, job: { select: { payRate: true, billRate: true } } } } } });
  const { from, to } = weekRange(ymd(weekEnding), tz);
  const punched = new Set((await tdb.timeEntry.findMany({ where: { clockIn: { gte: from, lt: to } }, select: { applicationId: true } })).map((e) => e.applicationId));
  const filled: string[] = [], kept: string[] = [], clocked: string[] = [];
  for (const h of scheduledHours(shifts)) {
    const app = shifts.find((s) => s.applicationId === h.applicationId)!.application;
    if (punched.has(app.id)) { clocked.push(app.candidate.name); continue; } // the time clock is the better record
    const existing = await tdb.timesheet.findFirst({ where: { applicationId: app.id, weekEnding } });
    if (existing && (existing.status !== 'DRAFT' || Number(existing.regularHours) + Number(existing.overtimeHours) > 0)) { kept.push(app.candidate.name); continue; }
    const hrs = { regularHours: h.regularHours, overtimeHours: h.overtimeHours };
    if (existing) await tdb.timesheet.updateMany({ where: { id: existing.id, status: 'DRAFT', regularHours: 0, overtimeHours: 0 }, data: hrs });
    else {
      try { await tdb.timesheet.create({ data: { applicationId: app.id, weekEnding, ...hrs, payRate: app.job.payRate ?? 0, billRate: app.job.billRate ?? 0 } as never }); }
      catch (e) { if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e; kept.push(app.candidate.name); continue; }
    }
    filled.push(app.candidate.name);
  }
  return { week: ymd(weekEnding), filled: filled.length, kept: [...new Set(kept)], clocked: [...new Set(clocked)] };
}
