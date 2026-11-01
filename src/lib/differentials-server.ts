import { z } from 'zod';
import { Prisma, type Organization, type User } from '@prisma/client';
import { HttpError, logActivity, type TenantDb } from './tenant';
import { audit } from './audit';
import { parseWeek } from './weeks';
import { localDate, weekEndingOf } from './timeclock';
import { MODES, RULE_KINDS, TIMED_KINDS, applicableRules, inRegularRate, perHour, premiumTotals, timedHours, validTime, type RuleKind } from './differentials';

type Ctx = { tdb: TenantDb; org: Organization; user: User };
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | number) => Number(d);
const usd = (n: number) => `$${n.toFixed(2)}`;

export const RuleBody = z.object({
  name: z.string().trim().min(2, 'Name the differential (e.g. “Night shift”).').max(80, 'Keep the name under 80 characters.'),
  kind: z.enum(Object.keys(RULE_KINDS) as [RuleKind, ...RuleKind[]], { errorMap: () => ({ message: 'Choose what kind of premium it is.' }) }),
  mode: z.enum(Object.keys(MODES) as [keyof typeof MODES, ...(keyof typeof MODES)[]], { errorMap: () => ({ message: 'Choose how it’s paid.' }) }),
  pay: z.coerce.number().min(0, 'The pay amount can’t be negative.').max(1000, 'That pay amount looks too high.'),
  bill: z.coerce.number().min(0, 'The bill amount can’t be negative.').max(1000, 'That bill amount looks too high.'),
  clientId: z.string().nullable().optional(),
  jobId: z.string().nullable().optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use full dates for holidays.')).max(60).optional(),
  active: z.boolean().optional(),
}).superRefine((b, ctx) => {
  if (b.mode === 'MULTIPLY' && (b.pay < 1 || b.pay > 3)) ctx.addIssue({ code: 'custom', message: 'A pay multiplier is between 1 and 3 (e.g. 1.5 for time and a half).' });
  if (b.mode === 'MULTIPLY' && b.bill !== 0 && (b.bill < 1 || b.bill > 3)) ctx.addIssue({ code: 'custom', message: 'A bill multiplier is between 1 and 3, or 0 to bill nothing extra.' });
  if (b.kind === 'NIGHT' && (!validTime(b.startTime) || !validTime(b.endTime))) ctx.addIssue({ code: 'custom', message: 'Give the night hours, like 19:00 to 07:00.' });
  if (b.kind === 'HOLIDAY' && !b.holidays?.length) ctx.addIssue({ code: 'custom', message: 'Add the holiday dates.' });
});

const ruleJson = (r: Awaited<ReturnType<TenantDb['payRule']['findMany']>>[number] & { client?: { name: string } | null; job?: { title: string } | null }) => ({
  id: r.id, name: r.name, kind: r.kind as RuleKind, mode: r.mode as keyof typeof MODES, pay: num(r.pay), bill: num(r.bill), clientId: r.clientId, jobId: r.jobId,
  client: r.client?.name ?? null, job: r.job?.title ?? null, startTime: r.startTime, endTime: r.endTime, holidays: r.holidays, active: r.active,
});
export type RuleJson = ReturnType<typeof ruleJson>;

export async function listRules(tdb: TenantDb) {
  return (await tdb.payRule.findMany({ include: { client: { select: { name: true } }, job: { select: { title: true } } }, orderBy: [{ active: 'desc' }, { kind: 'asc' }, { name: 'asc' }] })).map(ruleJson);
}

async function scope(tdb: TenantDb, b: { clientId?: string | null; jobId?: string | null }) {
  if (b.jobId) { const j = await tdb.job.findFirst({ where: { id: b.jobId }, select: { id: true, clientId: true } }); if (!j) throw new HttpError(404, 'That job was deleted.'); return { jobId: j.id, clientId: j.clientId }; }
  if (b.clientId) { const c = await tdb.client.findFirst({ where: { id: b.clientId }, select: { id: true } }); if (!c) throw new HttpError(404, 'That client was deleted.'); return { jobId: null, clientId: c.id }; }
  return { jobId: null, clientId: null };
}
const describeRule = (b: z.infer<typeof RuleBody>) => `${b.name}: ${b.mode === 'MULTIPLY' ? `${b.pay}× pay${b.bill ? `, ${b.bill}× bill` : ''}` : `${usd(b.pay)}/hr pay, ${usd(b.bill)}/hr bill`}`;

export async function saveRule({ tdb, org, user }: Ctx, b: z.infer<typeof RuleBody>, id?: string) {
  const where = await scope(tdb, b), isNew = !id;
  const data = {
    name: b.name, kind: b.kind, mode: b.mode, pay: new Prisma.Decimal(b.pay), bill: new Prisma.Decimal(b.bill), ...where,
    startTime: b.kind === 'NIGHT' ? b.startTime : null, endTime: b.kind === 'NIGHT' ? b.endTime : null, holidays: b.kind === 'HOLIDAY' ? [...new Set(b.holidays)].sort() : [],
    ...(b.active !== undefined ? { active: b.active } : {}),
  };
  if (id) {
    const { count } = await tdb.payRule.updateMany({ where: { id }, data });
    if (!count) throw new HttpError(404, 'That differential was deleted.');
  } else id = (await tdb.payRule.create({ data: data as never })).id;
  await audit(org.id, user, 'payrule.change', `${isNew ? 'Added' : 'Changed'} pay differential ${describeRule(b)}`, { targetType: 'payRule', targetId: id });
  return id;
}

export async function setRuleActive({ tdb, org, user }: Ctx, id: string, active: boolean) {
  const r = await tdb.payRule.findFirst({ where: { id } });
  if (!r) throw new HttpError(404, 'That differential was deleted.');
  await tdb.payRule.updateMany({ where: { id }, data: { active } });
  await audit(org.id, user, 'payrule.change', `${active ? 'Turned on' : 'Turned off'} pay differential ${r.name}`, { targetType: 'payRule', targetId: id });
}

// ---- premiums on a timesheet ----

async function assignment(tdb: TenantDb, applicationId: string) {
  const app = await tdb.application.findFirst({ where: { id: applicationId, stage: 'PLACED' }, include: { candidate: { select: { name: true } }, job: { select: { id: true, title: true, clientId: true, payRate: true, billRate: true } }, employee: { select: { payType: true, payRate: true } } } });
  if (!app) throw new HttpError(404, 'That worker is no longer on this assignment.');
  if (app.employee?.payType === 'SALARY') throw new HttpError(409, 'Salaried employees are paid their salary, not from timesheets.');
  return app;
}

/** The week's timesheet, created as a blank draft (with today's rates snapshotted) when there isn't one. Approved ones can't change. */
async function draftSheet(tdb: TenantDb, app: Awaited<ReturnType<typeof assignment>>, week: Date) {
  let t = await tdb.timesheet.findFirst({ where: { applicationId: app.id, weekEnding: week } });
  if (!t) {
    try { t = await tdb.timesheet.create({ data: { applicationId: app.id, weekEnding: week, regularHours: 0, overtimeHours: 0, payRate: app.employee?.payRate ?? app.job.payRate ?? 0, billRate: app.job.billRate ?? 0 } as never }); }
    catch (e) { if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e; t = await tdb.timesheet.findFirst({ where: { applicationId: app.id, weekEnding: week } }); }
  }
  if (!t || t.status !== 'DRAFT') throw new HttpError(409, 'This timesheet is already approved. Reopen it before changing premiums.');
  return t;
}

const lineJson = (p: Awaited<ReturnType<TenantDb['timesheetPremium']['findMany']>>[number]) => ({
  id: p.id, label: p.label, kind: p.kind, mode: p.mode, hours: num(p.hours), payPerHour: num(p.payPerHour), billPerHour: num(p.billPerHour), inRegularRate: p.inRegularRate, auto: p.auto,
});
export type PremiumJson = ReturnType<typeof lineJson>;

/** The week's premium lines and the differentials that apply to the assignment. */
export async function premiumsFor(tdb: TenantDb, applicationId: string, weekStr: string) {
  const week = parseWeek(weekStr), app = await assignment(tdb, applicationId);
  const [t, rules] = await Promise.all([
    tdb.timesheet.findFirst({ where: { applicationId: app.id, weekEnding: week }, include: { premiums: { orderBy: { createdAt: 'asc' } } } }),
    tdb.payRule.findMany({ where: { active: true } }),
  ]);
  const pay = Number(t?.payRate ?? app.employee?.payRate ?? app.job.payRate ?? 0), bill = Number(t?.billRate ?? app.job.billRate ?? 0);
  const apply = applicableRules(rules.map((r) => ({ ...r, pay: num(r.pay), bill: num(r.bill) })), app.job);
  return {
    status: t?.status ?? 'NOT_ENTERED', lines: (t?.premiums ?? []).map(lineJson),
    rules: apply.map((r) => ({ id: r.id, name: r.name, kind: r.kind, mode: r.mode, timed: TIMED_KINDS.includes(r.kind as RuleKind), ...perHour(r, pay, bill) })),
  };
}

export const AddBody = z.object({
  applicationId: z.string().min(1), week: z.string(), ruleId: z.string().min(1, 'Choose a differential.'),
  hours: z.coerce.number().positive('Enter the hours.').max(168, 'More hours than exist in a week.'),
});

/** Premium hours must fit the week: on hours worked for most kinds, or on top of them for on-call style flat pay. */
function checkHours(t: { regularHours: Prisma.Decimal; overtimeHours: Prisma.Decimal }, existing: { mode: string; hours: Prisma.Decimal }[], mode: string, hours: number) {
  const worked = num(t.regularHours) + num(t.overtimeHours);
  if (mode !== 'FLAT' && hours > worked + 1e-9) throw new HttpError(400, worked ? `That’s more than the ${+worked.toFixed(2)} hours worked this week.` : 'Enter the hours worked first — this premium is paid on hours worked.');
  const flat = existing.filter((e) => e.mode === 'FLAT').reduce((s, e) => s + num(e.hours), 0) + (mode === 'FLAT' ? hours : 0);
  if (worked + flat > 168) throw new HttpError(400, 'More hours than exist in a week.');
}

async function touched(tdb: TenantDb, timesheetId: string) {
  // Changed pay needs the client's sign-off again, as changed hours do.
  await tdb.timesheet.updateMany({ where: { id: timesheetId, status: 'DRAFT' }, data: { clientApprovedAt: null, clientApprovedBy: null } });
}

export async function addPremium({ tdb, org, user }: Ctx, b: z.infer<typeof AddBody>) {
  const app = await assignment(tdb, b.applicationId), week = parseWeek(b.week);
  const rule = await tdb.payRule.findFirst({ where: { id: b.ruleId, active: true } });
  if (!rule) throw new HttpError(404, 'That differential was turned off or deleted.');
  const r = { ...rule, pay: num(rule.pay), bill: num(rule.bill) };
  // Checked against every rule: a job's own night rule replaces the company-wide one, so that one no longer applies.
  const apply = applicableRules((await tdb.payRule.findMany({ where: { active: true } })).map((x) => ({ ...x, pay: num(x.pay), bill: num(x.bill) })), app.job);
  if (!apply.some((x) => x.id === rule.id)) throw new HttpError(400, 'That differential is for a different client or job, or this job has its own.');
  const t = await draftSheet(tdb, app, week);
  checkHours(t, await tdb.timesheetPremium.findMany({ where: { timesheetId: t.id } }), rule.mode, b.hours);
  const per = perHour(r, num(t.payRate), num(t.billRate));
  await tdb.timesheetPremium.create({ data: { timesheetId: t.id, ruleId: rule.id, label: rule.name, kind: rule.kind, mode: rule.mode, hours: new Prisma.Decimal(b.hours), payPerHour: new Prisma.Decimal(per.pay), billPerHour: new Prisma.Decimal(per.bill), inRegularRate: inRegularRate(r) } as never });
  await touched(tdb, t.id);
  await logActivity(org.id, `Added ${b.hours}h ${rule.name} for ${app.candidate.name} (week ending ${ymd(week)})`, user.id);
}

export async function removePremium({ tdb, org, user }: Ctx, id: string) {
  const p = await tdb.timesheetPremium.findFirst({ where: { id }, include: { timesheet: { select: { id: true, status: true, weekEnding: true, application: { select: { candidate: { select: { name: true } } } } } } } });
  if (!p) throw new HttpError(404, 'That premium was already removed.');
  if (p.timesheet.status !== 'DRAFT') throw new HttpError(409, 'This timesheet is already approved. Reopen it before changing premiums.');
  await tdb.timesheetPremium.deleteMany({ where: { id } });
  await touched(tdb, p.timesheet.id);
  await logActivity(org.id, `Removed ${num(p.hours)}h ${p.label} for ${p.timesheet.application.candidate.name} (week ending ${ymd(p.timesheet.weekEnding)})`, user.id);
}

/**
 * Works out night, weekend and holiday hours from the week's time clock punches, replacing the lines it worked out
 * before (lines added by hand stay).
 */
export async function calculateFromClock({ tdb, org, user }: Ctx, applicationId: string, weekStr: string) {
  const app = await assignment(tdb, applicationId), week = parseWeek(weekStr), w = ymd(week);
  const t = await draftSheet(tdb, app, week);
  const rules = applicableRules((await tdb.payRule.findMany({ where: { active: true, kind: { in: TIMED_KINDS } } })).map((r) => ({ ...r, pay: num(r.pay), bill: num(r.bill) })), app.job);
  if (!rules.length) throw new HttpError(409, 'There are no night, weekend or holiday differentials for this job. Add them under Pay differentials.');
  const from = new Date(week.getTime() - 8 * 864e5), to = new Date(week.getTime() + 2 * 864e5);
  const punches = (await tdb.timeEntry.findMany({ where: { applicationId: app.id, clockIn: { gte: from, lt: to }, clockOut: { not: null } } }))
    .filter((e) => weekEndingOf(localDate(e.clockIn, org.timezone)) === w);
  if (!punches.length) throw new HttpError(409, 'No time clock punches for this week. Add the premium hours by hand.');
  const lines = rules.map((r) => ({ r, hours: timedHours(punches, r, org.timezone) })).filter((x) => x.hours > 0);
  await tdb.timesheetPremium.deleteMany({ where: { timesheetId: t.id, auto: true } });
  const worked = num(t.regularHours) + num(t.overtimeHours);
  for (const { r, hours } of lines) {
    const per = perHour(r, num(t.payRate), num(t.billRate));
    // Never more premium hours than the timesheet's hours (they may have been edited after the punches).
    await tdb.timesheetPremium.create({ data: { timesheetId: t.id, ruleId: r.id, label: r.name, kind: r.kind, mode: r.mode, hours: new Prisma.Decimal(Math.min(hours, worked || hours)), payPerHour: new Prisma.Decimal(per.pay), billPerHour: new Prisma.Decimal(per.bill), inRegularRate: inRegularRate(r), auto: true } as never });
  }
  await touched(tdb, t.id);
  await logActivity(org.id, `Worked out differentials from the time clock for ${app.candidate.name} (week ending ${w}): ${lines.map((l) => `${l.hours}h ${l.r.name}`).join(', ') || 'none'}`, user.id);
  return { lines: lines.length };
}

/** A timesheet's premium totals in dollars, for rows, exports and runs. */
export function sheetPremiums(t: { regularHours: Prisma.Decimal | number; overtimeHours: Prisma.Decimal | number; premiums?: { label: string; hours: Prisma.Decimal | number; payPerHour: Prisma.Decimal | number; billPerHour: Prisma.Decimal | number; inRegularRate: boolean }[] }) {
  const lines = (t.premiums ?? []).map((p) => ({ label: p.label, hours: num(p.hours), payPerHour: num(p.payPerHour), billPerHour: num(p.billPerHour), inRegularRate: p.inRegularRate }));
  const tot = premiumTotals(lines, num(t.regularHours), num(t.overtimeHours));
  return { lines, pay: tot.totalPay / 100, bill: tot.bill / 100, overtime: tot.overtime / 100 };
}
