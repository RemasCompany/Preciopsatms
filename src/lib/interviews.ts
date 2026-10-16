// Interviews: kinds, scorecard scales, calendar invites and the summary of everyone's feedback.
// Shared by the UI and the server — keep this file free of server imports.

export const INTERVIEW_KINDS = { PHONE: 'Phone', VIDEO: 'Video', ONSITE: 'In person' } as const;
export type InterviewKind = keyof typeof INTERVIEW_KINDS;
export const INTERVIEW_STATUS = {
  PROPOSED: { text: 'Waiting for the candidate to pick a time', pill: 'a' }, SCHEDULED: { text: 'Scheduled', pill: '' },
  COMPLETED: { text: 'Done', pill: 'g' }, NO_SHOW: { text: 'No-show', pill: 'r' }, CANCELLED: { text: 'Cancelled', pill: '' },
} as const;
export type InterviewStatus = keyof typeof INTERVIEW_STATUS;

/** Rated 1–4 on every scorecard (no middle option, so interviewers commit). Job skills are added per job. */
export const CORE_COMPETENCIES = ['Communication', 'Reliability and attendance', 'Safety mindset', 'Teamwork'];
export const RATING = { 1: 'Strong concerns', 2: 'Some concerns', 3: 'Meets the bar', 4: 'Exceeds the bar' } as const;
export const RECOMMENDATIONS = { STRONG_YES: 'Strong yes', YES: 'Yes', NO: 'No', STRONG_NO: 'Strong no' } as const;
export type Recommendation = keyof typeof RECOMMENDATIONS;

/** What a scorecard asks about: the core list plus up to four of the job's skills. */
export const competenciesFor = (skills: string[]) => [...CORE_COMPETENCIES, ...skills.filter((s) => !CORE_COMPETENCIES.includes(s)).slice(0, 4)];

export const MAX_SLOTS = 6;
/** Offered times: in the future, at most six, no two overlapping for the same interview length. */
export function slotProblem(slots: Date[], durationMin: number, now = new Date()) {
  if (!slots.length) return 'Offer at least one time.';
  if (slots.length > MAX_SLOTS) return `Offer up to ${MAX_SLOTS} times.`;
  if (slots.some((s) => Number.isNaN(s.getTime()))) return 'One of the times isn’t a valid date and time.';
  if (slots.some((s) => s.getTime() < now.getTime() + 30 * 60e3)) return 'Every time needs to be at least 30 minutes from now.';
  const sorted = [...slots].sort((a, b) => a.getTime() - b.getTime());
  for (let i = 1; i < sorted.length; i++) if (sorted[i].getTime() - sorted[i - 1].getTime() < durationMin * 60e3) return 'Two of the times overlap. Space them at least one interview apart.';
  return null;
}
export const overlap = (a: Date, aMin: number, b: Date, bMin: number) => a.getTime() < b.getTime() + bMin * 60e3 && b.getTime() < a.getTime() + aMin * 60e3;

type Card = { ratings: Record<string, number>; recommendation: string };
/** Everyone's feedback in one line per competency, plus the recommendations. */
export function summarize(cards: Card[]) {
  const comps = new Map<string, number[]>();
  for (const c of cards) for (const [k, v] of Object.entries(c.ratings ?? {})) if (v >= 1 && v <= 4) comps.set(k, [...(comps.get(k) ?? []), v]);
  const recs = { STRONG_YES: 0, YES: 0, NO: 0, STRONG_NO: 0 } as Record<Recommendation, number>;
  for (const c of cards) if (c.recommendation in recs) recs[c.recommendation as Recommendation]++;
  const yes = recs.STRONG_YES + recs.YES, no = recs.NO + recs.STRONG_NO;
  return {
    count: cards.length,
    competencies: [...comps.entries()].map(([name, v]) => ({ name, average: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10, ratings: v.length })),
    recommendations: recs,
    // Mixed when anyone said no while others said yes: worth a conversation before deciding.
    verdict: !cards.length ? null : no === 0 ? (recs.STRONG_YES > recs.YES ? 'Strong yes' : 'Yes') : yes === 0 ? 'No' : 'Mixed',
  };
}

// ---- calendar invites (RFC 5545) ----
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
/** Folds lines at 75 octets, as calendar apps require. */
const bytes = (s: string) => new TextEncoder().encode(s).length;
const fold = (line: string) => { const out: string[] = []; let rest = line; while (bytes(rest) > 74) { let n = 74; while (bytes(rest.slice(0, n)) > 74) n--; out.push(rest.slice(0, n)); rest = ` ${rest.slice(n)}`; } out.push(rest); return out.join('\r\n'); };

export function icsInvite(e: { uid: string; start: Date; durationMin: number; summary: string; description: string; location: string | null; organizer: { name: string; email: string }; attendees: { name: string; email: string }[]; sequence: number; cancel?: boolean; now?: Date }) {
  const end = new Date(e.start.getTime() + e.durationMin * 60e3);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Preciops//Interviews//EN', 'CALSCALE:GREGORIAN', `METHOD:${e.cancel ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${icsDate(e.now ?? new Date())}`, `DTSTART:${icsDate(e.start)}`, `DTEND:${icsDate(end)}`, `SEQUENCE:${e.sequence}`,
    `SUMMARY:${icsText(e.summary)}`, `DESCRIPTION:${icsText(e.description)}`, ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    `ORGANIZER;CN=${icsText(e.organizer.name)}:mailto:${e.organizer.email}`,
    ...e.attendees.map((a) => `ATTENDEE;CN=${icsText(a.name)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${a.email}`),
    `STATUS:${e.cancel ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
