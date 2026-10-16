// Labor planning math: this year against last year, a 13-week hours forecast, the current team's capacity, and the
// hires needed to close the gap. Pure functions over weekly rows (week = the Sunday that ends it, YYYY-MM-DD), so
// they're easy to test and reuse for any slice (a department, a location, a client, a position).

export type WeekRow = { week: string; segment: string; worker: string; hours: number; overtime: number; costCents: number; billCents: number };
export type Totals = { hours: number; overtime: number; costCents: number; billCents: number; workers: number };

const toDay = (s: string) => Date.parse(`${s}T00:00:00Z`) / 864e5;
export const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round(toDay(b) - toDay(a));
/** The Sunday ending the week that contains `s`. */
export const weekOf = (s: string) => addDays(s, (7 - new Date(`${s}T00:00:00Z`).getUTCDay()) % 7);
/** The same week a year earlier (52 weeks back, so it's also a Sunday). */
export const lastYearWeek = (week: string) => addDays(week, -364);
const r1 = (n: number) => Math.round(n * 10) / 10;

function total(rows: WeekRow[]): Totals {
  const workers = new Set<string>();
  let hours = 0, overtime = 0, costCents = 0, billCents = 0;
  for (const r of rows) { hours += r.hours; overtime += r.overtime; costCents += r.costCents; billCents += r.billCents; if (r.hours > 0) workers.add(r.worker); }
  return { hours: r1(hours), overtime: r1(overtime), costCents, billCents, workers: workers.size };
}

/** Hours per week (all segments, or one). */
export function weekly(rows: WeekRow[], segment?: string) {
  const m = new Map<string, number>();
  for (const r of rows) if (!segment || r.segment === segment) m.set(r.week, (m.get(r.week) ?? 0) + r.hours);
  return m;
}

/**
 * Month by month for `year` and the year before. Months after `through` this year are left empty; the month that
 * `through` falls in is partial, so it's compared with the same weeks last year.
 */
export function monthly(rows: WeekRow[], year: number, through: string) {
  const cut = through.slice(0, 7), lyCut = lastYearWeek(through);
  const byMonth = (y: number, m: number, until?: string) => rows.filter((r) => Number(r.week.slice(0, 4)) === y && Number(r.week.slice(5, 7)) === m && (!until || r.week <= until));
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1, key = `${year}-${String(m).padStart(2, '0')}`, partial = key === cut && through.slice(8) < '28';
    return { month: m, partial, thisYear: key <= cut ? total(byMonth(year, m, partial ? through : undefined)) : null, lastYear: total(byMonth(year - 1, m, partial ? lyCut : undefined)), lastYearFull: total(byMonth(year - 1, m)) };
  });
}

/** Year to date against the same weeks last year. */
export function yearToDate(rows: WeekRow[], year: number, through: string) {
  const start = `${year}-01-01`, end = through;
  const ty = rows.filter((r) => r.week >= start && r.week <= end);
  const ly = rows.filter((r) => r.week >= lastYearWeek(weekOf(start)) && r.week <= lastYearWeek(end));
  const a = total(ty), b = total(ly);
  const change = (x: number, y: number) => (y ? r1(((x - y) / y) * 100) : null);
  const weeks = new Set(ty.map((r) => r.week)).size || 1, lyWeeks = new Set(ly.map((r) => r.week)).size || 1;
  return {
    thisYear: a, lastYear: b,
    change: { hours: change(a.hours, b.hours), costCents: change(a.costCents, b.costCents), overtimeShare: a.hours && b.hours ? r1((a.overtime / a.hours - b.overtime / b.hours) * 100) : null, avgWorkers: change(avgWorkers(ty, weeks), avgWorkers(ly, lyWeeks)) },
    costPerHour: { thisYear: a.hours ? a.costCents / 100 / a.hours : null, lastYear: b.hours ? b.costCents / 100 / b.hours : null },
    avgWorkers: { thisYear: r1(avgWorkers(ty, weeks)), lastYear: r1(avgWorkers(ly, lyWeeks)) },
  };
}
function avgWorkers(rows: WeekRow[], weeks: number) {
  const per = new Map<string, Set<string>>();
  for (const r of rows) if (r.hours > 0) per.set(r.week, (per.get(r.week) ?? new Set()).add(r.worker));
  return [...per.values()].reduce((s, x) => s + x.size, 0) / weeks;
}

/**
 * Hours needed each of the next `horizon` weeks. Last year's same weeks (averaged with their neighbours, to smooth
 * out holidays) are scaled by this year's trend — the last 13 weeks against the same 13 weeks last year. With no
 * history it falls back to the recent weekly average. Shifts already on the schedule set a floor.
 */
export function forecast(hours: Map<string, number>, lastWeek: string, opts: { horizon?: number; scheduled?: Map<string, number> } = {}) {
  const horizon = opts.horizon ?? 13;
  const recent = Array.from({ length: 13 }, (_, i) => addDays(lastWeek, -7 * i));
  const ty = recent.reduce((s, w) => s + (hours.get(w) ?? 0), 0), ly = recent.reduce((s, w) => s + (hours.get(lastYearWeek(w)) ?? 0), 0);
  const trend = ly > 0 && ty > 0 ? Math.min(2, Math.max(0.5, ty / ly)) : null;
  const avg8 = recent.slice(0, 8).reduce((s, w) => s + (hours.get(w) ?? 0), 0) / 8;
  return Array.from({ length: horizon }, (_, i) => {
    const week = addDays(lastWeek, 7 * (i + 1)), base = lastYearWeek(week);
    const lyAround = [-7, 0, 7].map((d) => hours.get(addDays(base, d)) ?? 0), lyAvg = (lyAround[0] + 2 * lyAround[1] + lyAround[2]) / 4;
    const model = trend !== null && lyAvg > 0 ? lyAvg * trend : avg8;
    const scheduled = opts.scheduled?.get(week) ?? 0;
    return { week, model: r1(model), scheduled: r1(scheduled), hours: r1(Math.max(model, scheduled)), lastYear: r1(lyAround[1]), basis: trend !== null && lyAvg > 0 ? 'last-year' as const : 'recent' as const };
  });
}

/**
 * What the current team can cover: people who worked in the last 4 weeks, at their typical weekly hours, shrinking by
 * the turnover seen over the last half year (people who worked 14–26 weeks ago but not in the last 13).
 */
export function capacity(rows: WeekRow[], lastWeek: string, horizon = 13) {
  const inWeeks = (from: number, to: number) => { const a = addDays(lastWeek, -7 * to), b = addDays(lastWeek, -7 * from); return rows.filter((r) => r.week > a && r.week <= b && r.hours > 0); };
  const active = new Set(inWeeks(0, 4).map((r) => r.worker));
  // Typical weekly hours per person: the median of person-weeks over the last 8 weeks.
  const perPersonWeek = new Map<string, number>();
  for (const r of inWeeks(0, 8)) perPersonWeek.set(`${r.worker}|${r.week}`, (perPersonWeek.get(`${r.worker}|${r.week}`) ?? 0) + r.hours);
  const vals = [...perPersonWeek.values()].sort((a, b) => a - b);
  const perWorker = vals.length ? vals[Math.floor(vals.length / 2)] : 32;
  const before = new Set(inWeeks(13, 26).map((r) => r.worker)), recent = new Set(inWeeks(0, 13).map((r) => r.worker));
  const left = [...before].filter((w) => !recent.has(w)).length;
  const quarterly = before.size ? left / before.size : 0, weeklyTurnover = 1 - Math.pow(1 - Math.min(quarterly, 0.9), 1 / 13);
  const weeks = Array.from({ length: horizon }, (_, i) => ({ week: addDays(lastWeek, 7 * (i + 1)), people: r1(active.size * Math.pow(1 - weeklyTurnover, i + 1)), hours: r1(active.size * Math.pow(1 - weeklyTurnover, i + 1) * perWorker) }));
  return { active: active.size, hoursPerWorker: r1(perWorker), turnoverQuarterly: r1(quarterly * 100), weeks };
}

export type PlanWeek = { week: string; need: number; capacity: number; gapHours: number; gapPeople: number };
/**
 * Hires to close the gap between forecast hours and capacity. The peak shortfall in people, to the nearest person
 * (ignoring under half a person), is the number to hire; hiring should start the time-to-fill before the first week short by
 * half a person or more. Open requisitions already count toward it.
 */
export function hiringPlan(f: ReturnType<typeof forecast>, c: ReturnType<typeof capacity>, today: string, timeToFillDays: number, openReqs = 0) {
  const per = c.hoursPerWorker || 32;
  const weeks: PlanWeek[] = f.map((w, i) => { const cap = c.weeks[i]?.hours ?? 0, gap = r1(w.hours - cap); return { week: w.week, need: w.hours, capacity: cap, gapHours: gap, gapPeople: r1(gap / per) }; });
  const peak = weeks.reduce((m, w) => (w.gapPeople > m.gapPeople ? w : m), weeks[0] ?? { week: today, need: 0, capacity: 0, gapHours: 0, gapPeople: 0 });
  // Short by half a person or more at the peak: hire that many, to the nearest person.
  const needed = peak.gapPeople >= 0.5 ? Math.max(1, Math.round(peak.gapPeople)) : 0;
  const hires = Math.max(0, needed - openReqs);
  const first = weeks.find((w) => w.gapPeople >= 0.5);
  // Start hiring this long before people are needed (they start the Monday of that week).
  const startBy = first ? addDays(first.week, -6 - timeToFillDays) : null;
  const surplus = weeks.length && weeks.every((w) => w.gapPeople <= -1) ? Math.floor(-Math.max(...weeks.map((w) => w.gapPeople))) : 0;
  return { weeks, peak: peak.gapPeople > 0 ? peak : null, needed, openReqs, hires, firstShortWeek: first?.week ?? null, startBy, late: !!startBy && startBy < today, surplus };
}
