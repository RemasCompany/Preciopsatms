import { z } from 'zod';
import type { Organization, Role, User } from '@prisma/client';
import { HttpError, logActivity, tenantDb, type TenantDb } from './tenant';
import { audit } from './audit';
import { db } from './db';
import { localDate } from './timeclock';
import { parse } from './people';
import { EMPLOYMENT_TYPES } from './people-shared';

/**
 * Time off: policies (vacation, sick…), requests and a balance ledger. Time taken is recorded one row per day, so a
 * week's paid time off can go onto that week's timesheet, at the regular rate and never as overtime.
 */
type Ctx = { tdb: TenantDb; org: Organization; user: User; role: Role };
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => ymd(new Date(day(s).getTime() + n * 864e5));
const weekOf = (s: string) => { const x = day(s); x.setUTCDate(x.getUTCDate() + ((7 - x.getUTCDay()) % 7)); return ymd(x); };
const r2 = (n: number) => Math.round(n * 100) / 100;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date.');
export const MAX_DAYS = 90;

export const PolicyBody = z.object({
  name: z.string().trim().min(1, 'Name the policy (e.g. Vacation, Sick).').max(60),
  paid: z.boolean().default(true),
  method: z.enum(['NONE', 'ANNUAL', 'HOURS_WORKED'], { errorMap: () => ({ message: 'Choose how time is earned.' }) }),
  rate: z.coerce.number().min(0, 'The rate can’t be negative.').max(2000, 'That rate looks too high.').default(0),
  maxBalance: z.coerce.number().min(0).max(5000).nullable().optional(),
  waitingDays: z.coerce.number().int().min(0).max(730).default(0),
  types: z.array(z.enum(EMPLOYMENT_TYPES)).default([]),
}).refine((p) => p.method === 'NONE' || p.rate > 0, { message: 'Enter how many hours are earned.', path: ['rate'] })
  .refine((p) => p.method !== 'HOURS_WORKED' || p.rate <= 1, { message: 'Hours earned per hour worked must be 1 or less (e.g. 0.0333 is 1 hour per 30 worked).', path: ['rate'] });
export const RequestBody = z.object({
  employeeId: z.string().min(1, 'Choose an employee.'), policyId: z.string().min(1, 'Choose the kind of time off.'),
  startDate: DATE, endDate: DATE,
  hoursPerDay: z.coerce.number().positive('Enter hours per day.').max(24, 'A day has 24 hours at most.').default(8),
  note: z.string().trim().max(500).optional().nullable().transform((v) => v || null),
});
export const DecideBody = z.object({
  action: z.enum(['approve', 'deny', 'cancel']), note: z.string().trim().max(500).optional().nullable().transform((v) => v || null),
  clearShifts: z.boolean().default(true),
});
export const AdjustBody = z.object({
  employeeId: z.string().min(1), policyId: z.string().min(1),
  hours: z.coerce.number().refine((n) => n !== 0, 'Enter hours to add, or negative hours to take away.').refine((n) => Math.abs(n) <= 2000, 'That’s more hours than a balance can hold.'),
  note: z.string().trim().min(2, 'Say why (e.g. starting balance, correction).').max(300),
});

const isAdmin = (role: Role) => role === 'OWNER' || role === 'ADMIN';
export const tracked = (p: { method: string }) => p.method !== 'NONE';
const eligible = (p: { types: string[] }, e: { employmentType: string }) => !p.types.length || p.types.includes(e.employmentType);

// ---- policies ----
export async function savePolicy(ctx: Ctx, id: string | null, body: unknown) {
  const b = parse(PolicyBody, body);
  const { tdb, org, user } = ctx;
  const clash = await tdb.leavePolicy.findFirst({ where: { name: { equals: b.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
  if (clash) throw new HttpError(409, `There’s already a ${b.name} policy.`);
  const data = { name: b.name, paid: b.paid, method: b.method, rate: b.method === 'NONE' ? 0 : b.rate, maxBalance: b.maxBalance ?? null, waitingDays: b.waitingDays, types: b.types };
  if (id) {
    const { count } = await tdb.leavePolicy.updateMany({ where: { id }, data });
    if (!count) throw new HttpError(404, 'That policy was deleted.');
  } else id = (await tdb.leavePolicy.create({ data: data as never })).id;
  await audit(org.id, user, 'leave.policy', `${id ? 'Saved' : 'Added'} the ${b.name} time-off policy`, { targetType: 'LeavePolicy', targetId: id });
  return { id };
}

/** Archived policies can't be requested any more; balances and history stay. */
export async function archivePolicy(ctx: Ctx, id: string, archived: boolean) {
  const p = await ctx.tdb.leavePolicy.findFirst({ where: { id } });
  if (!p) throw new HttpError(404, 'That policy was deleted.');
  await ctx.tdb.leavePolicy.updateMany({ where: { id }, data: { archived } });
  await audit(ctx.org.id, ctx.user, 'leave.policy', `${archived ? 'Archived' : 'Restored'} the ${p.name} time-off policy`, { targetType: 'LeavePolicy', targetId: id });
}

// ---- balances ----
/** Balance (ledger sum) and hours waiting for approval, per employee and policy. */
export async function balances(tdb: TenantDb, employeeIds?: string[]) {
  const where = employeeIds ? { employeeId: { in: employeeIds } } : {};
  const [sums, pending] = await Promise.all([
    tdb.leaveEntry.groupBy({ by: ['employeeId', 'policyId'], where, _sum: { hours: true } }),
    tdb.leaveRequest.groupBy({ by: ['employeeId', 'policyId'], where: { ...where, status: 'PENDING' }, _sum: { hours: true } }),
  ]);
  const out = new Map<string, { balance: number; pending: number }>();
  const key = (e: string, p: string) => `${e}:${p}`;
  for (const s of sums) out.set(key(s.employeeId, s.policyId), { balance: r2(Number(s._sum.hours ?? 0)), pending: 0 });
  for (const s of pending) { const k = key(s.employeeId, s.policyId); out.set(k, { balance: out.get(k)?.balance ?? 0, pending: r2(Number(s._sum.hours ?? 0)) }); }
  return { get: (e: string, p: string) => out.get(key(e, p)) ?? { balance: 0, pending: 0 } };
}

/** The days a request covers: days they're scheduled, or weekdays if nothing is scheduled in the range. */
export async function leaveDays(tdb: TenantDb, candidateId: string, start: string, end: string) {
  const shifts = await tdb.shift.findMany({ where: { cancelled: false, application: { candidateId }, date: { gte: day(start), lte: day(end) } }, select: { date: true } });
  if (shifts.length) return [...new Set(shifts.map((s) => ymd(s.date)))].sort();
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) { const w = day(d).getUTCDay(); if (w !== 0 && w !== 6) out.push(d); }
  return out;
}

// ---- requests ----
export async function requestLeave(ctx: Pick<Ctx, 'tdb' | 'org'> & { user: User | null }, body: unknown, opts: { byEmployee?: boolean } = {}) {
  const b = parse(RequestBody, body);
  const { tdb, org } = ctx;
  if (b.endDate < b.startDate) throw new HttpError(400, 'The last day is before the first day.');
  if ((day(b.endDate).getTime() - day(b.startDate).getTime()) / 864e5 >= MAX_DAYS) throw new HttpError(400, `Request up to ${MAX_DAYS} days at a time.`);
  const e = await tdb.employee.findFirst({ where: { id: b.employeeId }, include: { candidate: { select: { name: true } } } });
  if (!e) throw new HttpError(404, 'That employee was deleted.');
  if (e.status === 'TERMINATED') throw new HttpError(409, `${e.candidate.name} no longer works here.`);
  const p = await tdb.leavePolicy.findFirst({ where: { id: b.policyId, archived: false } });
  if (!p) throw new HttpError(404, 'That kind of time off isn’t offered any more.');
  if (!eligible(p, e)) throw new HttpError(409, `${p.name} isn’t offered to ${e.employmentType.toLowerCase().replace('_', '-')} employees.`);
  if (p.waitingDays && b.startDate < addDays(ymd(e.startDate), p.waitingDays)) throw new HttpError(409, `${p.name} can be used from ${addDays(ymd(e.startDate), p.waitingDays)} (${p.waitingDays} days after starting).`);
  const clash = await tdb.leaveRequest.findFirst({ where: { employeeId: e.id, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: day(b.endDate) }, endDate: { gte: day(b.startDate) } }, include: { policy: { select: { name: true } } } });
  if (clash) throw new HttpError(409, `That overlaps ${clash.status === 'PENDING' ? 'a pending' : 'approved'} ${clash.policy.name.toLowerCase()} request (${ymd(clash.startDate)} to ${ymd(clash.endDate)}).`);
  const days = await leaveDays(tdb, e.candidateId, b.startDate, b.endDate);
  if (!days.length) throw new HttpError(400, 'Those dates are all weekends with nothing scheduled. Pick days they’d be working.');
  const hours = r2(days.length * b.hoursPerDay);
  if (tracked(p)) {
    const bal = (await balances(tdb, [e.id])).get(e.id, p.id);
    const available = r2(bal.balance - bal.pending);
    if (hours > available) throw new HttpError(409, `That’s ${hours} hours, and ${available > 0 ? `only ${available} ${p.name.toLowerCase()} hours are available` : `no ${p.name.toLowerCase()} hours are available`}${bal.pending ? ` (${bal.pending} already requested)` : ''}.`);
  }
  const r = await tdb.leaveRequest.create({ data: { employeeId: e.id, policyId: p.id, startDate: day(b.startDate), endDate: day(b.endDate), hoursPerDay: b.hoursPerDay, hours, note: b.note, byEmployee: !!opts.byEmployee, createdById: ctx.user?.id ?? null } as never });
  await logActivity(org.id, `${e.candidate.name} asked for ${p.name.toLowerCase()}: ${b.startDate}${b.endDate !== b.startDate ? ` to ${b.endDate}` : ''} (${hours}h)`, ctx.user?.id ?? undefined);
  return { id: r.id, hours, days: days.length };
}

/** Approve, deny or cancel. Approving records the time taken and (by default) takes their shifts on those days off the schedule. */
export async function decide(ctx: Ctx, id: string, body: unknown) {
  const b = parse(DecideBody, body);
  const { tdb, org, user } = ctx;
  const r = await tdb.leaveRequest.findFirst({ where: { id }, include: { policy: true, employee: { include: { candidate: { select: { name: true } } } } } });
  if (!r) throw new HttpError(404, 'That request was deleted.');
  const who = r.employee.candidate.name, what = `${r.policy.name.toLowerCase()} ${ymd(r.startDate)}${+r.endDate !== +r.startDate ? ` to ${ymd(r.endDate)}` : ''}`;
  const weeks = () => { const w = new Set<string>(); for (let d = ymd(r.startDate); d <= ymd(r.endDate); d = addDays(d, 1)) w.add(weekOf(d)); return [...w]; };

  if (b.action === 'deny') {
    if (r.status !== 'PENDING') throw new HttpError(409, 'Only pending requests can be denied.');
    await tdb.leaveRequest.updateMany({ where: { id }, data: { status: 'DENIED', decidedById: user.id, decidedAt: new Date(), decisionNote: b.note } });
    await audit(org.id, user, 'leave.decide', `Denied ${who}’s ${what}${b.note ? `: ${b.note}` : ''}`, { targetType: 'LeaveRequest', targetId: id });
    return { status: 'DENIED' };
  }
  if (b.action === 'cancel') {
    if (r.status !== 'PENDING' && r.status !== 'APPROVED') throw new HttpError(409, 'This request is already closed.');
    await tdb.leaveEntry.deleteMany({ where: { requestId: id } });
    await tdb.leaveRequest.updateMany({ where: { id }, data: { status: 'CANCELLED', decidedById: user.id, decidedAt: new Date(), decisionNote: b.note } });
    const locked = r.status === 'APPROVED' ? await syncLeaveTimesheets(tdb, r.employeeId, weeks()) : [];
    await audit(org.id, user, 'leave.decide', `Cancelled ${who}’s ${what}`, { targetType: 'LeaveRequest', targetId: id });
    return { status: 'CANCELLED', lockedWeeks: locked };
  }
  if (r.status !== 'PENDING') throw new HttpError(409, 'Only pending requests can be approved.');
  if (r.employee.status === 'TERMINATED') throw new HttpError(409, `${who} no longer works here.`);
  const days = await leaveDays(tdb, r.employee.candidateId, ymd(r.startDate), ymd(r.endDate));
  if (!days.length) throw new HttpError(409, 'Those days no longer include any workdays.');
  const per = Number(r.hoursPerDay), hours = r2(per * days.length);
  if (tracked(r.policy)) {
    const bal = (await balances(tdb, [r.employeeId])).get(r.employeeId, r.policyId);
    if (hours > bal.balance) throw new HttpError(409, `${who} has ${bal.balance} ${r.policy.name.toLowerCase()} hours, and this needs ${hours}. Deny it, or add hours to their balance first.`);
  }
  await tdb.leaveEntry.createMany({ data: days.map((d) => ({ organizationId: org.id, employeeId: r.employeeId, policyId: r.policyId, date: day(d), hours: -per, kind: 'USAGE', requestId: id, createdById: user.id })) });
  await tdb.leaveRequest.updateMany({ where: { id }, data: { status: 'APPROVED', hours, decidedById: user.id, decidedAt: new Date(), decisionNote: b.note } });
  let removed = 0;
  if (b.clearShifts) {
    const on = { application: { candidateId: r.employee.candidateId }, date: { in: days.map(day) }, cancelled: false };
    removed = (await tdb.shift.deleteMany({ where: { ...on, notifiedAt: null } })).count + (await tdb.shift.updateMany({ where: on, data: { cancelled: true, notified: false } })).count;
  }
  const locked = await syncLeaveTimesheets(tdb, r.employeeId, weeks());
  await audit(org.id, user, 'leave.decide', `Approved ${who}’s ${what} (${hours}h)`, { targetType: 'LeaveRequest', targetId: id });
  await logActivity(org.id, `Approved ${who}’s ${what}`, user.id);
  return { status: 'APPROVED', hours, removedShifts: removed, lockedWeeks: locked };
}

/**
 * Puts each week's approved paid time off on an hourly employee's timesheet (creating a draft if needed).
 * Approved or paid timesheets aren't changed; their weeks come back so someone can reopen them.
 */
export async function syncLeaveTimesheets(tdb: TenantDb, employeeId: string, weekEndings: string[]) {
  const e = await tdb.employee.findFirst({ where: { id: employeeId } });
  if (!e?.applicationId || e.payType !== 'HOURLY') return [];
  const locked: string[] = [];
  for (const w of weekEndings) {
    const from = day(addDays(w, -6)), to = day(w);
    const used = await tdb.leaveEntry.aggregate({ where: { employeeId, kind: 'USAGE', date: { gte: from, lte: to }, policy: { paid: true } }, _sum: { hours: true } });
    const leave = r2(-Number(used._sum.hours ?? 0));
    const t = await tdb.timesheet.findFirst({ where: { applicationId: e.applicationId, weekEnding: to } });
    if (t) {
      if (Number(t.leaveHours) === leave) continue;
      if (t.status !== 'DRAFT') { locked.push(w); continue; }
      await tdb.timesheet.updateMany({ where: { id: t.id, status: 'DRAFT' }, data: { leaveHours: leave } });
    } else if (leave > 0) {
      await tdb.timesheet.create({ data: { applicationId: e.applicationId, weekEnding: to, regularHours: 0, overtimeHours: 0, leaveHours: leave, payRate: e.payRate, billRate: 0 } as never });
    }
  }
  return locked;
}

export async function adjust(ctx: Ctx, body: unknown) {
  if (!isAdmin(ctx.role)) throw new HttpError(403, 'Only owners and admins can change balances.');
  const b = parse(AdjustBody, body);
  const { tdb, org, user } = ctx;
  const e = await tdb.employee.findFirst({ where: { id: b.employeeId }, include: { candidate: { select: { name: true } } } });
  const p = await tdb.leavePolicy.findFirst({ where: { id: b.policyId } });
  if (!e || !p) throw new HttpError(404, 'That employee or policy was deleted.');
  if (!tracked(p)) throw new HttpError(409, `${p.name} isn’t tracked, so it has no balance.`);
  await tdb.leaveEntry.create({ data: { employeeId: e.id, policyId: p.id, date: day(localDate(new Date(), org.timezone)), hours: b.hours, kind: 'ADJUSTMENT', note: b.note, createdById: user.id } as never });
  await audit(org.id, user, 'leave.adjust', `${b.hours > 0 ? 'Added' : 'Took away'} ${Math.abs(b.hours)} ${p.name.toLowerCase()} hours for ${e.candidate.name} (${b.note})`, { targetType: 'Employee', targetId: e.id });
  return { ok: true };
}

// ---- accruals ----
async function credit(tdb: TenantDb, orgId: string, e: { id: string }, p: { id: string; maxBalance: unknown }, hours: number, date: string, key: string, note: string) {
  if (hours <= 0 || (await tdb.leaveEntry.findFirst({ where: { accrualKey: key } }))) return 0;
  if (p.maxBalance != null) {
    const bal = Number((await tdb.leaveEntry.aggregate({ where: { employeeId: e.id, policyId: p.id }, _sum: { hours: true } }))._sum.hours ?? 0);
    hours = Math.min(hours, Number(p.maxBalance) - bal);
  }
  hours = r2(hours);
  if (hours <= 0) return 0;
  await tdb.leaveEntry.create({ data: { organizationId: orgId, employeeId: e.id, policyId: p.id, date: day(date), hours, kind: 'ACCRUAL', note, accrualKey: key } as never });
  return hours;
}

/** Hours-worked policies: earned when a timesheet is approved (worked hours only, never time off). */
export async function accrueForTimesheets(tdb: TenantDb, orgId: string, timesheetIds: string[]) {
  if (!timesheetIds.length) return;
  const sheets = await tdb.timesheet.findMany({ where: { id: { in: timesheetIds } }, include: { application: { include: { employee: true } } } });
  const policies = await tdb.leavePolicy.findMany({ where: { method: 'HOURS_WORKED', archived: false } });
  for (const t of sheets) {
    const e = t.application.employee;
    if (!e || e.status === 'TERMINATED') continue;
    const worked = Number(t.regularHours) + Number(t.overtimeHours);
    for (const p of policies.filter((x) => eligible(x, e))) await credit(tdb, orgId, e, p, worked * Number(p.rate), ymd(t.weekEnding), `${p.id}:ts:${t.id}`, `${+worked.toFixed(2)} hours worked, week ending ${ymd(t.weekEnding)}`);
  }
}
/** A reopened timesheet takes back what it earned; approving it again earns it again. */
export async function undoTimesheetAccruals(tdb: TenantDb, timesheetIds: string[]) {
  if (timesheetIds.length) await tdb.leaveEntry.deleteMany({ where: { kind: 'ACCRUAL', OR: timesheetIds.map((id) => ({ accrualKey: { endsWith: `:ts:${id}` } })) } });
}

/** Daily: annual policies credit a twelfth each month; salaried employees on hours-worked policies earn 40 hours' worth a week. */
export async function runLeaveAccruals(now = new Date()) {
  let credited = 0;
  const orgs = await db.organization.findMany({ where: { leavePolicies: { some: { archived: false, method: { not: 'NONE' } } } }, select: { id: true, timezone: true } });
  for (const o of orgs) {
    const tdb = tenantDb(o.id);
    const today = localDate(now, o.timezone), month = today.slice(0, 7), monthStart = `${month}-01`;
    const lastWeek = addDays(weekOf(today), -7); // the last finished Mon–Sun week
    const [policies, people] = await Promise.all([
      tdb.leavePolicy.findMany({ where: { archived: false, method: { not: 'NONE' } } }),
      tdb.employee.findMany({ where: { status: { not: 'TERMINATED' } } }),
    ]);
    for (const p of policies) for (const e of people.filter((x) => eligible(p, x))) {
      if (p.method === 'ANNUAL' && ymd(e.startDate) <= monthStart) credited += await credit(tdb, o.id, e, p, Number(p.rate) / 12, monthStart, `${p.id}:${e.id}:${month}`, `Monthly accrual, ${month}`);
      if (p.method === 'HOURS_WORKED' && e.payType === 'SALARY' && ymd(e.startDate) <= addDays(lastWeek, -6)) credited += await credit(tdb, o.id, e, p, 40 * Number(p.rate), lastWeek, `${p.id}:${e.id}:wk:${lastWeek}`, `40 hours (salaried), week ending ${lastWeek}`);
    }
  }
  return { credited: r2(credited) };
}
