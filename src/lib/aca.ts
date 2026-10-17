// Affordable Care Act tracking with the look-back measurement method (26 CFR 54.4980H-3). Pure functions, no DB.
//
// Hours of service come from weekly timesheets (worked + paid leave). A week counts toward the period its week-ending
// Sunday falls in, and "full-time" means averaging 30+ hours a week over a measurement period (the weekly equivalent of
// 130 hours a month). Months are whole calendar months; dates are 'YYYY-MM-DD' strings in UTC.

export const FT_WEEKLY = 30;
export const CLOSE_WEEKLY = 27; // "close to full-time" warning (90%)
export const BREAK_WEEKS = 13; // a break in service this long makes a returning worker a new employee

export type AcaPolicy = {
  measurementMonths: number; // standard measurement period length (3–12)
  adminMonths: number; // administrative period between measurement and stability (0–2, under the 90-day limit)
  stabilityMonths: number; // at least as long as the measurement period and at least 6
  startMonth: number; // 1–12: the month standard measurement periods start (e.g. 11 → Nov 1 – Oct 31 with a 12-month period)
};
export const DEFAULT_POLICY: AcaPolicy = { measurementMonths: 12, adminMonths: 2, stabilityMonths: 12, startMonth: 11 };

/** Problems with a policy, worded for the settings form (empty when valid). */
export function policyProblems(p: AcaPolicy) {
  const out: string[] = [];
  if (!Number.isInteger(p.measurementMonths) || p.measurementMonths < 3 || p.measurementMonths > 12) out.push('The measurement period must be 3 to 12 months.');
  if (!Number.isInteger(p.adminMonths) || p.adminMonths < 0 || p.adminMonths > 2) out.push('The administrative period can be up to 2 months (the limit is 90 days).');
  if (!Number.isInteger(p.stabilityMonths) || p.stabilityMonths < Math.max(6, p.measurementMonths) || p.stabilityMonths > 12) out.push(`The stability period must be at least ${Math.max(6, p.measurementMonths)} months (no shorter than the measurement period, and at least 6), and at most 12.`);
  if (!Number.isInteger(p.startMonth) || p.startMonth < 1 || p.startMonth > 12) out.push('Choose the month measurement periods start.');
  return out;
}

// ---- dates ----
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const ymd = (x: Date) => x.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => ymd(new Date(d(s).getTime() + n * 864e5));
/** First day of the month `n` months after the month containing `s`. */
export const addMonths = (s: string, n: number) => { const x = d(s); return ymd(new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + n, 1))); };
export const monthStart = (s: string) => `${s.slice(0, 7)}-01`;
const lastDay = (firstOfMonth: string) => addDays(addMonths(firstOfMonth, 1), -1);

export type Period = { start: string; end: string }; // inclusive
export type Cycle = { measurement: Period; admin: Period | null; stability: Period };

/** The standard cycle whose measurement period starts in `year` (on policy.startMonth). */
export function standardCycle(p: AcaPolicy, year: number): Cycle {
  const ms = `${year}-${String(p.startMonth).padStart(2, '0')}-01`;
  const as = addMonths(ms, p.measurementMonths), ss = addMonths(as, p.adminMonths);
  return {
    measurement: { start: ms, end: addDays(as, -1) },
    admin: p.adminMonths ? { start: as, end: addDays(ss, -1) } : null,
    stability: { start: ss, end: addDays(addMonths(ss, p.stabilityMonths), -1) },
  };
}

/** Standard cycles whose stability periods touch [from, to]. */
export function standardCycles(p: AcaPolicy, from: string, to: string) {
  const out: Cycle[] = [];
  for (let y = +from.slice(0, 4) - 3; y <= +to.slice(0, 4) + 1; y++) {
    const c = standardCycle(p, y);
    if (c.stability.end >= from && c.measurement.start <= to) out.push(c);
  }
  return out;
}

/**
 * A new employee's initial cycle: measurement starts the first of the month after their start (or on it, when they
 * start on the 1st). The initial measurement plus administrative period can't run past the end of the first full
 * calendar month after the first anniversary of the start date, so the administrative period is shortened if needed.
 */
export function initialCycle(p: AcaPolicy, start: string): Cycle {
  const ms = start.endsWith('-01') ? start : addMonths(start, 1);
  const as = addMonths(ms, p.measurementMonths);
  const anniv = `${+start.slice(0, 4) + 1}${start.slice(4)}`;
  const limitEnd = lastDay(anniv.endsWith('-01') ? anniv : addMonths(anniv, 1)); // last day of the first calendar month starting on/after the anniversary
  let ss = addMonths(as, p.adminMonths);
  while (ss > addDays(limitEnd, 1) && ss > as) ss = addMonths(ss, -1);
  return {
    measurement: { start: ms, end: addDays(as, -1) },
    admin: ss > as ? { start: as, end: addDays(ss, -1) } : null,
    stability: { start: ss, end: addDays(addMonths(ss, p.stabilityMonths), -1) },
  };
}

// ---- hours ----
export type Week = { weekEnding: string; hours: number }; // one worker's hours of service per week-ending Sunday
const within = (s: string, per: Period) => s >= per.start && s <= per.end;

/** Average weekly hours over a period, counting every week-ending Sunday in it (weeks without hours count as zero). */
export function averageWeekly(weeks: Week[], per: Period) {
  let total = 0;
  for (const w of weeks) if (within(w.weekEnding, per)) total += w.hours;
  const n = sundays(per).length;
  return { total, weeks: n, average: n ? total / n : 0 };
}
export function sundays(per: Period) {
  const out: string[] = [];
  let s = per.start;
  while (d(s).getUTCDay() !== 0) s = addDays(s, 1);
  for (; s <= per.end; s = addDays(s, 7)) out.push(s);
  return out;
}

/**
 * When the worker's current stretch of employment began: their first week with hours, or the first week back after a
 * break of 13+ weeks with no hours (they're then a new employee again).
 */
export function employmentStart(weeks: Week[]) {
  const worked = weeks.filter((w) => w.hours > 0).map((w) => w.weekEnding).sort();
  if (!worked.length) return null;
  let start = worked[0];
  for (let i = 1; i < worked.length; i++) {
    const gap = (d(worked[i]).getTime() - d(worked[i - 1]).getTime()) / (7 * 864e5) - 1;
    if (gap >= BREAK_WEEKS) start = worked[i];
  }
  return addDays(start, -6); // the Monday that week began
}

export type MonthStatus = 'full_time' | 'measuring' | 'not_full_time' | 'not_employed';
export type Evaluation = {
  start: string | null; // current employment stretch began
  kind: 'ongoing' | 'new' | null;
  months: Record<string, { status: MonthStatus; reason: string }>; // 'YYYY-MM' → status
  current: { label: string; period: Period; average: number; weeksSoFar: number; projected: 'full_time' | 'close' | 'part_time' } | null;
};

/**
 * Month-by-month status for one worker between `from` and `to` (first days of months), as of `today`.
 * Full-time in a month when a completed measurement period (initial or standard) averaged 30+ hours a week and the month
 * falls in its stability period. A new employee is "measuring" (a limited non-assessment period) during the initial
 * measurement and administrative periods. A month with no hours and no full-time stability is "not employed" when it's
 * after a break of 13+ weeks or before they started.
 */
export function evaluate(p: AcaPolicy, weeks: Week[], from: string, to: string, today: string): Evaluation {
  const start = employmentStart(weeks.filter((w) => w.weekEnding <= today));
  const months: Evaluation['months'] = {};
  const lastWorked = weeks.filter((w) => w.hours > 0 && w.weekEnding <= today).map((w) => w.weekEnding).sort().pop() ?? null;
  const init = start ? initialCycle(p, start) : null;
  // Cycles that decide full-time status: the initial one (new employees) and every standard one they were employed through.
  const decided: { cycle: Cycle; ft: boolean; label: string }[] = [];
  if (init && init.measurement.end < today) decided.push({ cycle: init, ft: averageWeekly(weeks, init.measurement).average >= FT_WEEKLY, label: 'initial' });
  for (const c of standardCycles(p, addMonths(from, -24), to)) {
    if (!start || c.measurement.end >= today) continue;
    if (start > c.measurement.start) continue; // not employed for the whole period: their initial period decides instead
    decided.push({ cycle: c, ft: averageWeekly(weeks, c.measurement).average >= FT_WEEKLY, label: 'standard' });
  }
  for (let m = monthStart(from); m <= to; m = addMonths(m, 1)) {
    const key = m.slice(0, 7), end = lastDay(m);
    const ftBy = decided.find((x) => x.ft && within(m, x.cycle.stability));
    if (ftBy) { months[key] = { status: 'full_time', reason: `Averaged 30+ hours a week in the ${ftBy.label} measurement period ${ftBy.cycle.measurement.start} to ${ftBy.cycle.measurement.end}.` }; continue; }
    if (!start || end < start) { months[key] = { status: 'not_employed', reason: 'Before they started.' }; continue; }
    if (lastWorked && m > addDays(lastWorked, BREAK_WEEKS * 7)) { months[key] = { status: 'not_employed', reason: `No hours for ${BREAK_WEEKS}+ weeks.` }; continue; }
    const inInitial = init && m >= init.measurement.start && m <= (init.admin?.end ?? init.measurement.end) && !standardCovers(decided, m);
    if (inInitial || (init && m < init.measurement.start)) { months[key] = { status: 'measuring', reason: 'New employee in their initial measurement period.' }; continue; }
    months[key] = { status: 'not_full_time', reason: 'Averaged under 30 hours a week in the measurement period that applies.' };
  }
  return { start, kind: start ? (isOngoing(p, start, today) ? 'ongoing' : 'new') : null, months, current: start ? currentMeasurement(p, weeks, start, today) : null };
}
const standardCovers = (decided: { cycle: Cycle; label: string }[], m: string) => decided.some((x) => x.label === 'standard' && within(m, x.cycle.stability));
const isOngoing = (p: AcaPolicy, start: string, today: string) => standardCycles(p, start, today).some((c) => start <= c.measurement.start && c.measurement.end < today);

/** The measurement period running now (initial for new employees, else standard) and how they're tracking. */
export function currentMeasurement(p: AcaPolicy, weeks: Week[], start: string, today: string): Evaluation['current'] {
  const init = initialCycle(p, start);
  let label: string, period: Period;
  if (today <= init.measurement.end) { label = 'Initial measurement'; period = init.measurement; }
  else {
    const y = +today.slice(0, 4);
    const c = [standardCycle(p, y - 1), standardCycle(p, y)].find((x) => within(today, x.measurement));
    if (!c) return null;
    label = 'Standard measurement'; period = c.measurement;
  }
  const soFar = { start: period.start > start ? period.start : start, end: today < period.end ? today : period.end };
  const counted = sundays({ start: period.start, end: soFar.end });
  const total = weeks.filter((w) => within(w.weekEnding, { start: period.start, end: soFar.end })).reduce((s, w) => s + w.hours, 0);
  const average = counted.length ? total / counted.length : 0;
  return { label, period, average, weeksSoFar: counted.length, projected: average >= FT_WEEKLY ? 'full_time' : average >= CLOSE_WEEKLY ? 'close' : 'part_time' };
}

// ---- applicable large employer ----
/**
 * Whether the company is an applicable large employer for `year`: in the prior calendar year it averaged 50+ full-time
 * employees plus full-time equivalents. Monthly: full-time = 130+ hours that month; everyone else's hours (up to 120
 * each) are added up and divided by 120. Hours come from weeks ending in each month. Seasonal-worker exceptions aren't
 * applied.
 */
export function aleTest(byPerson: Week[][], year: number) {
  const prior = year - 1;
  const months = Array.from({ length: 12 }, (_, i) => {
    const key = `${prior}-${String(i + 1).padStart(2, '0')}`;
    let ft = 0, ptHours = 0;
    for (const weeks of byPerson) {
      const h = weeks.filter((w) => w.weekEnding.startsWith(key)).reduce((s, w) => s + w.hours, 0);
      if (h >= 130) ft++; else ptHours += Math.min(h, 120);
    }
    return { month: key, fullTime: ft, fte: Math.floor((ptHours / 120) * 100) / 100 };
  });
  const average = months.reduce((s, m) => s + m.fullTime + m.fte, 0) / 12;
  return { year, priorYear: prior, months, average: Math.floor(average), ale: Math.floor(average) >= 50 };
}

// ---- offers and Form 1095-C ----
export const COVERAGE = { EMPLOYEE: 'Employee only', EMPLOYEE_CHILDREN: 'Employee and children', EMPLOYEE_SPOUSE: 'Employee and spouse', FAMILY: 'Employee, spouse and children' } as const;
export type Coverage = keyof typeof COVERAGE;
export type Offer = { coverageStart: string; coverageEnd: string | null; coverage: Coverage; minimumValue: boolean; employeeCost: number; response: 'PENDING' | 'ACCEPTED' | 'WAIVED' };

const LINE14: Record<Coverage, string> = { EMPLOYEE: '1B', EMPLOYEE_CHILDREN: '1C', EMPLOYEE_SPOUSE: '1D', FAMILY: '1E' };

/**
 * Suggested Form 1095-C codes for one month. Line 14: the offer (1B–1E by who it covered, 1F when it isn't minimum
 * value, 1H for no offer). Line 15: the employee's monthly cost for the lowest-cost self-only coverage. Line 16: 2C if
 * enrolled, 2A not employed, 2B not full-time, 2D limited non-assessment period; affordability safe harbors (2F/2G/2H)
 * are left for the filer, who knows the wages and safe harbor used.
 */
export function form1095Month(month: string, status: MonthStatus, offers: Offer[]) {
  const first = `${month}-01`, last = lastDay(first);
  const o = offers.find((x) => x.coverageStart <= last && (!x.coverageEnd || x.coverageEnd >= first) && x.coverageStart <= first);
  const line14 = !o ? '1H' : !o.minimumValue ? '1F' : LINE14[o.coverage];
  const line15 = o ? o.employeeCost.toFixed(2) : '';
  const line16 = o?.response === 'ACCEPTED' ? '2C' : status === 'not_employed' ? '2A' : status === 'measuring' ? '2D' : status === 'not_full_time' ? '2B' : '';
  return { line14, line15, line16 };
}

/** Who needs a 1095-C for the year: anyone full-time for at least one month, or enrolled through an offer. */
export const needs1095 = (ev: Evaluation, offers: Offer[], year: number) =>
  Object.entries(ev.months).some(([k, m]) => k.startsWith(`${year}-`) && m.status === 'full_time') || offers.some((o) => o.response === 'ACCEPTED' && o.coverageStart <= `${year}-12-31` && (!o.coverageEnd || o.coverageEnd >= `${year}-01-01`));
