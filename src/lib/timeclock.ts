// Time clock math: time zones, worked hours, workweeks, the overtime split and flags. Pure (no DB), shared with the UI.
import { WEEK_OT_THRESHOLD } from './payroll-run';

export const TIMEZONES: [string, string][] = [
  ['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'], ['America/Phoenix', 'Arizona'],
  ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii'], ['America/Puerto_Rico', 'Atlantic (Puerto Rico)'],
];
export const isTimezone = (tz: unknown): tz is string => typeof tz === 'string' && TIMEZONES.some(([z]) => z === tz);
/** An entry open this long is almost certainly a missed clock-out. */
export const MAX_OPEN_HOURS = 16;
export const LATE_MINUTES = 7;

const parts = (d: Date, tz: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(d).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, s: +p.second };
};
/** Minutes the zone is ahead of UTC at that instant (negative in the US). */
export function offsetMinutes(d: Date, tz: string) {
  const p = parts(d, tz);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}
/** "YYYY-MM-DD" of an instant in the zone. */
export const localDate = (d: Date, tz: string) => { const p = parts(d, tz); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
/** "HH:MM" of an instant in the zone. */
export const localTime = (d: Date, tz: string) => { const p = parts(d, tz); return `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`; };
/** The instant for a wall-clock date and time in the zone (handles daylight saving). */
export function zonedToUtc(date: string, time: string, tz: string) {
  const [y, m, d] = date.split('-').map(Number), [h, min] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  let t = guess - offsetMinutes(new Date(guess), tz) * 60000;
  t = guess - offsetMinutes(new Date(t), tz) * 60000; // second pass settles DST edges
  return new Date(t);
}
/** Sunday that ends the local workweek (Mon–Sun) containing `ymd`. */
export function weekEndingOf(ymd: string) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}

export type Entry = { id: string; applicationId: string; candidateId: string; clockIn: Date; clockOut: Date | null; breakMinutes: number; breakStartedAt?: Date | null };

/** Worked minutes: clock time less breaks (an open break counts up to now). */
export function workedMinutes(e: Pick<Entry, 'clockIn' | 'clockOut' | 'breakMinutes' | 'breakStartedAt'>, now = new Date()) {
  const end = e.clockOut ?? now;
  const onBreak = e.breakStartedAt && !e.clockOut ? Math.max(0, (now.getTime() - e.breakStartedAt.getTime()) / 60000) : 0;
  return Math.max(0, (end.getTime() - e.clockIn.getTime()) / 60000 - e.breakMinutes - onBreak);
}
export const hours = (m: number) => Math.round((m / 60) * 100) / 100;

/**
 * Weekly hours per assignment, split into regular and overtime. Hours from every assignment in the same local
 * workweek add up (the agency is the employer); once the worker passes 40, later hours are overtime on whichever
 * assignment they were worked.
 */
export function splitWeek(entries: Entry[], tz: string) {
  const out = new Map<string, { applicationId: string; weekEnding: string; regularMinutes: number; overtimeMinutes: number }>();
  const byWorkerWeek = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!e.clockOut) continue;
    const key = `${e.candidateId}|${weekEndingOf(localDate(e.clockIn, tz))}`;
    byWorkerWeek.set(key, [...(byWorkerWeek.get(key) ?? []), e]);
  }
  for (const [key, list] of byWorkerWeek) {
    const week = key.split('|')[1];
    let running = 0;
    for (const e of list.sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime())) {
      const m = workedMinutes(e);
      const reg = Math.max(0, Math.min(m, WEEK_OT_THRESHOLD * 60 - running));
      running += m;
      const k = `${e.applicationId}|${week}`;
      const cur = out.get(k) ?? { applicationId: e.applicationId, weekEnding: week, regularMinutes: 0, overtimeMinutes: 0 };
      cur.regularMinutes += reg; cur.overtimeMinutes += m - reg;
      out.set(k, cur);
    }
  }
  return [...out.values()].map((r) => ({ ...r, regularHours: hours(r.regularMinutes), overtimeHours: hours(r.overtimeMinutes) }));
}

export type ShiftRef = { date: string; start: string; end: string };
/** Flags a reviewer should look at. */
export function entryFlags(e: Entry & { shift?: ShiftRef | null; source?: string; editedAt?: Date | null }, tz: string, now = new Date()) {
  const f: { level: 'warn' | 'info'; text: string }[] = [];
  const open = !e.clockOut;
  if (open && (now.getTime() - e.clockIn.getTime()) / 3600000 > MAX_OPEN_HOURS) f.push({ level: 'warn', text: 'Missed clock-out' });
  if (!e.shift) f.push({ level: 'info', text: 'No scheduled shift' });
  else {
    const start = zonedToUtc(e.shift.date, e.shift.start, tz);
    const late = (e.clockIn.getTime() - start.getTime()) / 60000;
    if (late > LATE_MINUTES) f.push({ level: 'warn', text: `${Math.round(late)} min late` });
    if (e.clockOut) {
      const endDay = e.shift.end <= e.shift.start ? new Date(Date.parse(`${e.shift.date}T00:00:00Z`) + 864e5).toISOString().slice(0, 10) : e.shift.date;
      const early = (zonedToUtc(endDay, e.shift.end, tz).getTime() - e.clockOut.getTime()) / 60000;
      if (early > 15) f.push({ level: 'info', text: `Left ${Math.round(early)} min early` });
    }
  }
  if (e.clockOut && workedMinutes(e) > 6 * 60 && e.breakMinutes === 0) f.push({ level: 'info', text: 'No break over 6 hours' });
  if (e.source === 'STAFF') f.push({ level: 'info', text: 'Added by staff' });
  else if (e.editedAt) f.push({ level: 'info', text: 'Edited' });
  return f;
}
