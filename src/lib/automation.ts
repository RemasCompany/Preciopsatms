// Hiring automations a company can switch on: screen new applicants, offer interview times to screened ones, and start
// onboarding at the offer. Pure (settings and the time-picking math are shared with the UI and tested).
import { z } from 'zod';
import { INTERVIEW_KINDS, MAX_SLOTS } from './interviews';
import { localDate, zonedToUtc } from './timeclock';

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:00.');

export const AutomationBody = z.object({
  screen: z.object({
    on: z.boolean(),
    // Applicants whose match score reaches this move to Screened. Nobody is ever rejected automatically.
    advanceAt: z.coerce.number().int().min(40, 'Use a score of at least 40.').max(100, 'The highest score is 100.'),
  }),
  interviews: z.object({
    on: z.boolean(),
    interviewerId: z.string().nullable(),
    kind: z.enum(Object.keys(INTERVIEW_KINDS) as [keyof typeof INTERVIEW_KINDS]),
    durationMin: z.coerce.number().int().min(15, 'Interviews are at least 15 minutes.').max(120, 'Keep it to two hours or less.'),
    from: HHMM, to: HHMM,
    count: z.coerce.number().int().min(2, 'Offer at least two times.').max(MAX_SLOTS, `Offer up to ${MAX_SLOTS} times.`),
    location: z.string().trim().max(300).nullable(),
  }),
  onboarding: z.object({ on: z.boolean(), packageId: z.string().nullable() }),
  channels: z.array(z.enum(['email', 'sms'])).max(2),
}).superRefine((b, ctx) => {
  if (b.interviews.on && !b.interviews.interviewerId) ctx.addIssue({ code: 'custom', message: 'Choose who interviews.' });
  if (b.interviews.from >= b.interviews.to) ctx.addIssue({ code: 'custom', message: 'Interview hours have to end after they start.' });
  if (b.interviews.on && b.interviews.kind === 'ONSITE' && !b.interviews.location) ctx.addIssue({ code: 'custom', message: 'Add the address for in-person interviews.' });
  if (b.onboarding.on && !b.onboarding.packageId) ctx.addIssue({ code: 'custom', message: 'Choose the onboarding package.' });
  if ((b.interviews.on || b.onboarding.on) && !b.channels.length) ctx.addIssue({ code: 'custom', message: 'Choose how candidates hear from you (email, text or both).' });
});
export type Automation = z.infer<typeof AutomationBody>;

export const AUTOMATION_DEFAULTS: Automation = {
  screen: { on: false, advanceAt: 70 },
  interviews: { on: false, interviewerId: null, kind: 'VIDEO', durationMin: 30, from: '09:00', to: '17:00', count: 4, location: null },
  onboarding: { on: false, packageId: null },
  channels: ['email', 'sms'],
};

/** A company's settings, with defaults for anything not set yet (or set by an older version). */
export function automationOf(raw: unknown): Automation {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Automation>;
  return {
    screen: { ...AUTOMATION_DEFAULTS.screen, ...r.screen }, interviews: { ...AUTOMATION_DEFAULTS.interviews, ...r.interviews },
    onboarding: { ...AUTOMATION_DEFAULTS.onboarding, ...r.onboarding }, channels: Array.isArray(r.channels) ? r.channels : AUTOMATION_DEFAULTS.channels,
  };
}

const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Interview times to offer, as local "YYYY-MM-DDTHH:MM": weekdays from the next business day, inside the company's
 * interview hours, at most two a day (one in the morning, one later) so the candidate gets a real choice, skipping
 * times the interviewer is already booked.
 */
export function pickSlots(now: Date, tz: string, cfg: Pick<Automation['interviews'], 'from' | 'to' | 'durationMin' | 'count'>, busy: { start: Date; minutes: number }[] = []) {
  const out: string[] = [];
  const start = mins(cfg.from), end = mins(cfg.to) - cfg.durationMin;
  if (end < start) return out;
  const today = new Date(`${localDate(now, tz)}T00:00:00Z`);
  for (let d = 1; d <= 21 && out.length < cfg.count; d++) {
    const day = new Date(today.getTime() + d * 864e5);
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
    const ymd = day.toISOString().slice(0, 10);
    // Two candidate times a day: the start of the window, and the middle of the afternoon half.
    const tries = [...new Set([start, Math.max(start, Math.min(end, Math.round((start + end) / 2 / 30) * 30 + 60))])];
    let taken = 0;
    for (const t of tries) {
      for (let m = t; m <= end && taken < 2 && out.length < cfg.count; m += 30) {
        const at = zonedToUtc(ymd, hhmm(m), tz);
        const clash = busy.some((b) => at.getTime() < b.start.getTime() + b.minutes * 60e3 && b.start.getTime() < at.getTime() + cfg.durationMin * 60e3);
        const close = out.some((o) => o.slice(0, 10) === ymd && Math.abs(mins(o.slice(11)) - m) < cfg.durationMin);
        if (!clash && !close) { out.push(`${ymd}T${hhmm(m)}`); taken++; break; }
      }
    }
  }
  return out;
}
