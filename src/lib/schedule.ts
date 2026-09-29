// Shift scheduling math and wording. Shared by the builder (client) and the server — keep free of server imports.

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const WEEK_HOURS_BEFORE_OT = 40;
/** Quick picks in the shift form (common healthcare and security shifts). */
export const SHIFT_PRESETS: { label: string; start: string; end: string; breakMinutes: number }[] = [
  { label: '7a–7p', start: '07:00', end: '19:00', breakMinutes: 30 },
  { label: '7p–7a', start: '19:00', end: '07:00', breakMinutes: 30 },
  { label: '7a–3:30p', start: '07:00', end: '15:30', breakMinutes: 30 },
  { label: '3p–11:30p', start: '15:00', end: '23:30', breakMinutes: 30 },
  { label: '11p–7:30a', start: '23:00', end: '07:30', breakMinutes: 30 },
  { label: '9a–5:30p', start: '09:00', end: '17:30', breakMinutes: 30 },
];

export type ShiftTimes = { date: string; start: string; end: string; breakMinutes: number };

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** Length on the clock, in minutes; an end at or before the start runs overnight. */
export const spanMinutes = (start: string, end: string) => { const d = mins(end) - mins(start); return d > 0 ? d : d + 1440; };
export const overnight = (start: string, end: string) => mins(end) <= mins(start);
/** Paid hours: clock time less the unpaid break. */
export const shiftHours = (s: Pick<ShiftTimes, 'start' | 'end' | 'breakMinutes'>) => Math.max(0, spanMinutes(s.start, s.end) - s.breakMinutes) / 60;

/** Minutes since the epoch day of `date` 00:00, so overnight shifts compare correctly across days. */
function interval(s: ShiftTimes) {
  const day = Date.parse(`${s.date}T00:00:00Z`) / 60000;
  const from = day + mins(s.start);
  return [from, from + spanMinutes(s.start, s.end)] as const;
}
export const overlaps = (a: ShiftTimes, b: ShiftTimes) => { const [a0, a1] = interval(a), [b0, b1] = interval(b); return a0 < b1 && b0 < a1; };
/** Hours off between two shifts (negative when they overlap). */
export const restHours = (first: ShiftTimes, next: ShiftTimes) => (interval(next)[0] - interval(first)[1]) / 60;
export const MIN_REST_HOURS = 8;

/** Monday … Sunday of the week ending `weekEnding` (a Sunday, YYYY-MM-DD). */
export function weekDays(weekEnding: string) {
  const end = Date.parse(`${weekEnding}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => new Date(end - (6 - i) * 864e5).toISOString().slice(0, 10));
}
export const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** Weekly hours split at 40 into regular and overtime (paid at 1.5×). */
export function weekHours(shifts: Pick<ShiftTimes, 'start' | 'end' | 'breakMinutes'>[]) {
  const total = shifts.reduce((s, x) => s + shiftHours(x), 0);
  return { total, regular: Math.min(total, WEEK_HOURS_BEFORE_OT), overtime: Math.max(0, total - WEEK_HOURS_BEFORE_OT) };
}

export function clock(t: string) {
  const h = Number(t.slice(0, 2)), m = t.slice(3, 5);
  return `${h % 12 || 12}${m === '00' ? '' : `:${m}`}${h < 12 ? 'a' : 'p'}`;
}
export const clockLong = (t: string) => clock(t).replace(/([ap])$/, (x) => (x === 'a' ? ' AM' : ' PM'));
export const dayLabel = (ymd: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
const hrs = (h: number) => `${+h.toFixed(2)}h`;

/** "Mon, Oct 5 · 7:00 AM – 7:00 PM (11.5h) · ICU" */
export function describeShift(s: ShiftTimes & { unit?: string | null }) {
  return [dayLabel(s.date), `${clockLong(s.start)} – ${clockLong(s.end)}${overnight(s.start, s.end) ? ' (overnight)' : ''} (${hrs(shiftHours(s))})`, s.unit].filter(Boolean).join(' · ');
}

export type NoticeShift = ShiftTimes & { unit: string | null; notes: string | null; job: string; client: string | null; location: string | null; cancelled: boolean; isNew: boolean };

/** One merged schedule notice for one worker: new, changed and cancelled shifts, plus the confirmation link. */
export function scheduleNotice(o: { firstName: string; company: string; shifts: NoticeShift[]; link: string; channel: 'email' | 'sms' }) {
  const sorted = [...o.shifts].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const live = sorted.filter((s) => !s.cancelled), gone = sorted.filter((s) => s.cancelled);
  const onlyNew = live.every((s) => s.isNew) && !gone.length;
  const subject = onlyNew ? `Your schedule with ${o.company}` : `Schedule update from ${o.company}`;
  const where = (s: NoticeShift) => [s.job, s.client, s.location].filter(Boolean).join(', ');
  if (o.channel === 'sms') {
    const lines = [
      ...live.map((s) => `${s.isNew ? '' : 'CHANGED: '}${dayLabel(s.date)} ${clock(s.start)}-${clock(s.end)}${s.unit ? ` ${s.unit}` : ''} (${s.client ?? s.job})`),
      ...gone.map((s) => `CANCELLED: ${dayLabel(s.date)} ${clock(s.start)}-${clock(s.end)}`),
    ];
    return { subject, text: `${o.company}: hi ${o.firstName}, ${onlyNew ? 'your shifts' : 'your schedule changed'}:\n${lines.join('\n')}\nConfirm: ${o.link}` };
  }
  const text = [
    `Hi ${o.firstName},`, '',
    onlyNew ? `Here ${live.length === 1 ? 'is your shift' : 'are your shifts'} with ${o.company}:` : `Your schedule with ${o.company} has changed:`, '',
    ...live.flatMap((s) => [`${s.isNew ? '•' : '• CHANGED:'} ${describeShift(s)}`, `  ${where(s)}${s.notes ? ` — ${s.notes}` : ''}`]),
    ...(gone.length ? ['', 'Cancelled — please don’t come in for:', ...gone.map((s) => `• ${describeShift(s)} — ${where(s)}`)] : []),
    '', ...(live.length ? [`Please confirm each shift, or tell us if you can’t make it: ${o.link}`] : [`See your schedule: ${o.link}`]),
    '', 'Thank you,', o.company,
  ].join('\n');
  return { subject, text };
}

/** Day-before reminder for one worker's shifts tomorrow. */
export function reminderNotice(o: { firstName: string; company: string; shifts: NoticeShift[]; link: string; channel: 'email' | 'sms' }) {
  const s = [...o.shifts].sort((a, b) => a.start.localeCompare(b.start));
  if (o.channel === 'sms') return { subject: '', text: `${o.company}: reminder, you work tomorrow ${s.map((x) => `${clock(x.start)}-${clock(x.end)}${x.unit ? ` ${x.unit}` : ''} at ${x.client ?? x.job}`).join('; ')}. Details: ${o.link}` };
  return {
    subject: `Reminder: your shift tomorrow with ${o.company}`,
    text: [`Hi ${o.firstName},`, '', 'A reminder that you’re scheduled tomorrow:', ...s.map((x) => `• ${describeShift(x)} — ${[x.job, x.client, x.location].filter(Boolean).join(', ')}${x.notes ? ` — ${x.notes}` : ''}`),
      '', `If anything has changed, let us know right away: ${o.link}`, '', 'Thank you,', o.company].join('\n'),
  };
}
