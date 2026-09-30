// Worker engagement: birthdays, recognition and feedback. Pure (no DB), shared by the UI and the server.
// Birthdays are month and day only — never the year — so they can't reveal age, and they are never used in matching.

export const RECOGNITION_KINDS = {
  attendance: { label: 'Perfect attendance', emoji: '⏰' },
  client_praise: { label: 'Client praise', emoji: '🌟' },
  above_beyond: { label: 'Above and beyond', emoji: '🚀' },
  safety: { label: 'Safety star', emoji: '🦺' },
  milestone: { label: 'Milestone', emoji: '🎉' },
  other: { label: 'Kudos', emoji: '👏' },
} as const;
export type RecognitionKind = keyof typeof RECOGNITION_KINDS;

/** Days on assignment worth celebrating. */
export const MILESTONES = [30, 90, 180, 365, 730] as const;
export const milestoneLabel = (d: number) => (d >= 365 ? `${d / 365} year${d === 365 ? '' : 's'}` : `${d} days`);

const DAY = 864e5;
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export function validBirthday(month: number, day: number) {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return false;
  return day <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
/** The next date (today or later) the birthday falls on; Feb 29 is celebrated Feb 28 in other years. */
export function nextBirthday(month: number, day: number, today: string) {
  const [y] = today.split('-').map(Number);
  const on = (yr: number) => { const d = month === 2 && day === 29 && !isLeap(yr) ? 28 : day; return `${yr}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
  return on(y) >= today ? on(y) : on(y + 1);
}
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** Workers whose birthday is within `days` of today, soonest first. */
export function upcomingBirthdays<T extends { birthMonth: number | null; birthDay: number | null }>(people: T[], today: string, days = 30) {
  return people.flatMap((p) => {
    if (!p.birthMonth || !p.birthDay) return [];
    const date = nextBirthday(p.birthMonth, p.birthDay, today);
    const inDays = daysBetween(today, date);
    return inDays <= days ? [{ ...p, date, inDays }] : [];
  }).sort((a, b) => a.inDays - b.inDays);
}

/** Assignment anniversaries reached recently (within `lookback` days) or coming up (within `ahead` days). */
export function milestonesFor(placedOn: string, today: string, lookback = 7, ahead = 14) {
  const out: { days: number; date: string; inDays: number }[] = [];
  for (const m of MILESTONES) {
    const date = new Date(Date.parse(`${placedOn}T00:00:00Z`) + m * DAY).toISOString().slice(0, 10);
    const inDays = daysBetween(today, date);
    if (inDays >= -lookback && inDays <= ahead) out.push({ days: m, date, inDays });
  }
  return out;
}

export const RATING_LABELS = ['', 'Very poor', 'Poor', 'Okay', 'Good', 'Excellent'] as const;
export const WORKER_FACES = ['', '😞', '🙁', '😐', '🙂', '😄'] as const;
/** Average, count and the share of low (1–2) ratings. */
export function summarize(ratings: number[]) {
  if (!ratings.length) return { count: 0, average: null as number | null, low: 0 };
  return { count: ratings.length, average: Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10, low: ratings.filter((r) => r <= 2).length };
}
/** How often a worker is asked how things are going on their page. */
export const PULSE_DAYS = 14;

export function birthdayMessage(o: { firstName: string; company: string; channel: 'email' | 'sms' }) {
  return o.channel === 'sms'
    ? { subject: '', text: `${o.company}: Happy birthday, ${o.firstName}! 🎂 Thanks for all you do — we hope you have a great day.` }
    : { subject: `Happy birthday, ${o.firstName}!`, text: `Hi ${o.firstName},\n\nEveryone at ${o.company} wishes you a very happy birthday! Thank you for the great work you do — we hope today is a good one.\n\n${o.company}` };
}
export function recognitionMessage(o: { firstName: string; company: string; kind: RecognitionKind; message: string; channel: 'email' | 'sms' }) {
  const k = RECOGNITION_KINDS[o.kind];
  return o.channel === 'sms'
    ? { subject: '', text: `${o.company}: ${k.emoji} ${k.label}, ${o.firstName}! ${o.message}` }
    : { subject: `${k.emoji} ${k.label} — thank you, ${o.firstName}!`, text: `Hi ${o.firstName},\n\n${o.message}\n\nThank you from all of us at ${o.company}.` };
}
