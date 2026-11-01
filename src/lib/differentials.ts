// Pay differentials and premiums (night, weekend, holiday, on-call, call-back, charge, crisis). Pure: shared by the UI
// and server, and tested. Money is worked out in cents; the DB keeps Decimal.
import { offsetMinutes } from './timeclock';

export const RULE_KINDS = {
  NIGHT: 'Night shift', WEEKEND: 'Weekend', HOLIDAY: 'Holiday', ON_CALL: 'On call', CALL_BACK: 'Call-back',
  CHARGE: 'Charge / lead', CRISIS: 'Crisis / incentive', OTHER: 'Other',
} as const;
export type RuleKind = keyof typeof RULE_KINDS;
export const MODES = {
  ADD: 'Extra $ per hour, on hours worked',
  MULTIPLY: 'Times the rate, on hours worked',
  FLAT: '$ per hour, for hours not otherwise paid (e.g. on call)',
} as const;
export type Mode = keyof typeof MODES;
/** Kinds whose hours can be worked out from time clock punches. */
export const TIMED_KINDS: RuleKind[] = ['NIGHT', 'WEEKEND', 'HOLIDAY'];

export type RuleLike = { kind: string; mode: string; pay: number; bill: number };
const cents = (n: number) => Math.round(n * 100);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Extra pay and bill per premium hour at a timesheet's rates. A multiplier of 1 (or 0) on the bill side bills nothing extra. */
export function perHour(rule: RuleLike, payRate: number, billRate: number) {
  if (rule.mode === 'MULTIPLY') return { pay: r2(payRate * Math.max(0, rule.pay - 1)), bill: r2(billRate * Math.max(0, rule.bill - 1)) };
  return { pay: r2(rule.pay), bill: r2(rule.bill) };
}

/**
 * Whether a premium counts toward the regular rate overtime is figured on (FLSA, 29 CFR 778.207). Shift, charge, on-call
 * and incentive pay do; a premium of at least 1.5× for work on weekends or holidays doesn't (778.203), since it's itself
 * an overtime-style premium.
 */
export const inRegularRate = (rule: RuleLike) => !(rule.mode === 'MULTIPLY' && rule.pay >= 1.5 && (rule.kind === 'HOLIDAY' || rule.kind === 'WEEKEND'));

export type PremiumLine = { hours: number; payPerHour: number; billPerHour: number; inRegularRate: boolean };

/**
 * Premium pay and bill, in cents, plus the overtime they add: overtime is owed at 1.5× the regular rate, and premiums
 * that count raise that rate, so each overtime hour earns half the average counted premium per hour worked on top.
 */
export function premiumTotals(lines: PremiumLine[], regularHours: number, overtimeHours: number) {
  let pay = 0, bill = 0, counted = 0;
  for (const l of lines) {
    const p = cents(l.hours * l.payPerHour);
    pay += p; bill += cents(l.hours * l.billPerHour);
    if (l.inRegularRate) counted += p;
  }
  const worked = regularHours + overtimeHours;
  const overtime = worked > 0 && overtimeHours > 0 ? Math.round(0.5 * (counted / worked) * overtimeHours) : 0;
  return { pay, bill, overtime, totalPay: pay + overtime };
}

/** The most specific active rule of each kind for a job: the job's own, then its client's, then company-wide. */
export function applicableRules<T extends RuleLike & { active: boolean; jobId: string | null; clientId: string | null }>(rules: T[], job: { id: string; clientId: string | null }) {
  const rank = (r: T) => (r.jobId === job.id ? 0 : r.jobId ? -1 : r.clientId === job.clientId && r.clientId ? 1 : r.clientId ? -1 : 2);
  const best = new Map<string, T>();
  for (const r of rules.filter((x) => x.active && rank(x) >= 0).sort((a, b) => rank(a) - rank(b))) if (!best.has(r.kind)) best.set(r.kind, r);
  // Kinds that are often several separate premiums (incentives, other) keep every rule that applies.
  return rules.filter((r) => r.active && rank(r) >= 0 && (best.get(r.kind) === r || r.kind === 'CRISIS' || r.kind === 'OTHER'));
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const validTime = (s: string | null | undefined) => !!s && HHMM.test(s);
const minutesOf = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

/** Whether a local minute-of-day falls in a window, which may run past midnight (19:00–07:00). */
function inWindow(m: number, start: string, end: string) {
  const a = minutesOf(start), b = minutesOf(end);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

type Punch = { clockIn: Date; clockOut: Date | null; breakMinutes: number };
type Timed = { kind: string; startTime?: string | null; endTime?: string | null; holidays?: string[] };

/**
 * Premium hours in a week's punches for a night, weekend or holiday rule, in the company's time zone. Breaks are taken
 * out in proportion, since a punch doesn't say when the break was.
 */
export function timedHours(punches: Punch[], rule: Timed, tz: string) {
  let minutes = 0;
  for (const p of punches) {
    if (!p.clockOut) continue;
    const span = (p.clockOut.getTime() - p.clockIn.getTime()) / 60000;
    if (span <= 0) continue;
    let hit = 0, hour = -1, off = 0;
    for (let t = p.clockIn.getTime(); t < p.clockOut.getTime(); t += 60000) {
      // US offsets change on the hour, so one lookup per hour is enough.
      if (Math.floor(t / 36e5) !== hour) { hour = Math.floor(t / 36e5); off = offsetMinutes(new Date(t), tz); }
      const local = new Date(t + off * 60000);
      const day = local.toISOString().slice(0, 10), dow = local.getUTCDay(), m = local.getUTCHours() * 60 + local.getUTCMinutes();
      if (rule.kind === 'NIGHT' ? validTime(rule.startTime) && validTime(rule.endTime) && inWindow(m, rule.startTime!, rule.endTime!)
        : rule.kind === 'WEEKEND' ? dow === 0 || dow === 6
        : rule.kind === 'HOLIDAY' ? (rule.holidays ?? []).includes(day) : false) hit++;
    }
    minutes += hit * Math.max(0, span - p.breakMinutes) / span;
  }
  return r2(minutes / 60);
}

/** The six holidays most hospitals pay a premium for: New Year's, Memorial Day, July 4th, Labor Day, Thanksgiving, Christmas. */
export function majorHolidays(year: number) {
  const nth = (month: number, weekday: number, n: number) => { const d = new Date(Date.UTC(year, month, 1)); d.setUTCDate(1 + ((weekday - d.getUTCDay() + 7) % 7) + (n - 1) * 7); return d; };
  const last = (month: number, weekday: number) => { const d = new Date(Date.UTC(year, month + 1, 0)); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - weekday + 7) % 7)); return d; };
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return [`${year}-01-01`, iso(last(4, 1)), `${year}-07-04`, iso(nth(8, 1, 1)), iso(nth(10, 4, 4)), `${year}-12-25`];
}
