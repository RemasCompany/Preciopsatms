import { HttpError } from './http-error';

/** Week ending Sunday, as a UTC-midnight Date (matches @db.Date columns). */
export function weekEnding(d = new Date()) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() + ((7 - x.getUTCDay()) % 7));
  return x;
}
export function parseWeek(s: string | null) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return weekEnding();
  const d = new Date(`${s}T00:00:00Z`);
  if (d.getUTCDay() !== 0) throw new HttpError(400, 'Week ending must be a Sunday');
  return d;
}
export const ymd = (d: Date) => d.toISOString().slice(0, 10);
export const OT_MULTIPLIER = 1.5;
export const addWeeks = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + 7 * n); return x; };
