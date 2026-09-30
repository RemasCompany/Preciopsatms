// State and city labor rules that affect scheduling, time and job postings. These produce warnings, not blocks:
// whether a rule applies can depend on industry and company size, so the app flags and leaves the call to you.
// Sources: state labor department guidance as of 2026; review annually.

export type Place = { city: string | null; state: string | null };

/** "Orlando, FL" / "Brooklyn, NY 11201" → { city, state }. */
export function parsePlace(location: string | null | undefined): Place {
  const m = (location ?? '').match(/^\s*([^,]+?)\s*,\s*([A-Za-z]{2})\b/);
  return m ? { city: m[1].trim(), state: m[2].toUpperCase() } : { city: null, state: null };
}

// ---- pay transparency: postings must include a pay range ----
export const PAY_TRANSPARENCY: Record<string, string> = {
  CA: 'California', CO: 'Colorado', DC: 'Washington, DC', HI: 'Hawaii', IL: 'Illinois', MD: 'Maryland', MA: 'Massachusetts',
  MN: 'Minnesota', NJ: 'New Jersey', NY: 'New York', VT: 'Vermont', WA: 'Washington',
};
/** Why a posted job is missing required pay information, or null. */
export function payTransparencyIssue(job: { location: string | null; publish: boolean; status: string; payRate: unknown; remote?: boolean }, showPayOnCareers: boolean) {
  if (!job.publish || job.status !== 'OPEN') return null;
  const { state } = parsePlace(job.location);
  if (!state || !PAY_TRANSPARENCY[state]) return null;
  if (job.payRate == null || Number(job.payRate) <= 0) return `${PAY_TRANSPARENCY[state]} requires the pay rate or range in job postings — add a pay rate.`;
  if (!showPayOnCareers) return `${PAY_TRANSPARENCY[state]} requires the pay rate or range in job postings — turn on “Show pay rates” for your careers page.`;
  return null;
}

// ---- meal breaks: an unpaid meal break once a shift passes a length ----
export const MEAL_BREAKS: Record<string, { name: string; afterHours: number; minutes: number; second?: number }> = {
  CA: { name: 'California', afterHours: 5, minutes: 30, second: 10 }, CO: { name: 'Colorado', afterHours: 5, minutes: 30 }, CT: { name: 'Connecticut', afterHours: 7.5, minutes: 30 },
  DE: { name: 'Delaware', afterHours: 7.5, minutes: 30 }, IL: { name: 'Illinois', afterHours: 7.5, minutes: 20 }, MA: { name: 'Massachusetts', afterHours: 6, minutes: 30 },
  ME: { name: 'Maine', afterHours: 6, minutes: 30 }, NE: { name: 'Nebraska', afterHours: 8, minutes: 30 }, NH: { name: 'New Hampshire', afterHours: 5, minutes: 30 },
  NV: { name: 'Nevada', afterHours: 8, minutes: 30 }, NY: { name: 'New York', afterHours: 6, minutes: 30 }, ND: { name: 'North Dakota', afterHours: 5, minutes: 30 },
  OR: { name: 'Oregon', afterHours: 6, minutes: 30 }, RI: { name: 'Rhode Island', afterHours: 6, minutes: 20 }, TN: { name: 'Tennessee', afterHours: 6, minutes: 30 },
  WA: { name: 'Washington', afterHours: 5, minutes: 30 }, WV: { name: 'West Virginia', afterHours: 6, minutes: 20 },
};
/** A worked stretch with too little break for the state, or null. */
export function mealBreakIssue(state: string | null, workedMinutes: number, breakMinutes: number) {
  const r = state ? MEAL_BREAKS[state] : undefined;
  if (!r || workedMinutes <= r.afterHours * 60) return null;
  const need = r.second && workedMinutes > r.second * 60 ? r.minutes * 2 : r.minutes;
  if (breakMinutes >= need) return null;
  return `${r.name}: a ${need === r.minutes ? `${r.minutes}-minute meal break` : `second meal break (${need} minutes total)`} is due after ${need === r.minutes ? r.afterHours : r.second} hours — ${breakMinutes ? `only ${breakMinutes} min recorded` : 'none recorded'}. A waiver or premium pay may apply.`;
}

// ---- daily overtime ----
export const DAILY_OT: Record<string, { name: string; after: number; double?: number }> = {
  CA: { name: 'California', after: 8, double: 12 }, AK: { name: 'Alaska', after: 8 }, NV: { name: 'Nevada', after: 8 }, CO: { name: 'Colorado', after: 12 },
};
/** A shift long enough to trigger daily overtime (payroll here computes weekly overtime only), or null. */
export function dailyOtIssue(state: string | null, hours: number) {
  const r = state ? DAILY_OT[state] : undefined;
  if (!r || hours <= r.after) return null;
  return `${r.name}: hours over ${r.after} in a day are overtime${r.double && hours > r.double ? `, and over ${r.double} are double time` : ''}. Adjust the timesheet’s overtime hours if this applies to you.`;
}

// ---- predictive scheduling (fair workweek) ----
const FAIR_WORKWEEK: { name: string; state: string; cities?: string[] }[] = [
  { name: 'Oregon', state: 'OR' },
  { name: 'Seattle', state: 'WA', cities: ['Seattle'] },
  { name: 'San Francisco', state: 'CA', cities: ['San Francisco'] }, { name: 'Los Angeles', state: 'CA', cities: ['Los Angeles'] },
  { name: 'Berkeley', state: 'CA', cities: ['Berkeley'] }, { name: 'Emeryville', state: 'CA', cities: ['Emeryville'] },
  { name: 'Chicago', state: 'IL', cities: ['Chicago'] }, { name: 'Evanston', state: 'IL', cities: ['Evanston'] },
  { name: 'New York City', state: 'NY', cities: ['New York', 'New York City', 'NYC', 'Manhattan', 'Brooklyn', 'Bronx', 'The Bronx', 'Queens', 'Staten Island'] },
  { name: 'Philadelphia', state: 'PA', cities: ['Philadelphia'] },
];
export const NOTICE_DAYS = 14;
export function fairWorkweek(p: Place) {
  if (!p.state) return null;
  return FAIR_WORKWEEK.find((j) => j.state === p.state && (!j.cities || (p.city && j.cities.some((c) => c.toLowerCase() === p.city!.toLowerCase())))) ?? null;
}
/** Scheduling or changing a shift inside the notice window where predictive scheduling laws apply, or null. */
export function noticeIssue(location: string | null, shiftDate: string, today: string) {
  const j = fairWorkweek(parsePlace(location));
  if (!j) return null;
  const days = Math.round((Date.parse(`${shiftDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5);
  if (days >= NOTICE_DAYS) return null;
  return `${j.name} predictive scheduling: shifts should be posted ${NOTICE_DAYS} days ahead — this one is ${days <= 0 ? 'today or past' : `${days} day${days === 1 ? '' : 's'} out`}. If the law covers this job, the change may owe predictability pay.`;
}

/** Everything that applies to one shift at a job. */
export function shiftRuleWarnings(job: { location: string | null }, shift: { date: string; hours: number; breakMinutes: number }, today: string) {
  const { state } = parsePlace(job.location);
  return [noticeIssue(job.location, shift.date, today), dailyOtIssue(state, shift.hours), mealBreakIssue(state, Math.round(shift.hours * 60 + shift.breakMinutes), shift.breakMinutes)].filter(Boolean) as string[];
}
