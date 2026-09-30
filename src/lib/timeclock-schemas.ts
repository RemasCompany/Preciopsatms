import { z } from 'zod';
import { HttpError } from './tenant';
import { zonedToUtc } from './timeclock';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.');
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time.');
export const PunchTimes = z.object({
  inDate: DATE, inTime: TIME, outDate: DATE.optional().nullable(), outTime: TIME.optional().nullable(),
  breakMinutes: z.coerce.number({ invalid_type_error: 'Enter the break in minutes.' }).int().min(0, 'The break can’t be negative.').max(480, 'That break is too long.'),
  reason: z.string().trim().min(3, 'Say why (e.g. “Forgot to clock out”). It’s kept with the entry.').max(300, 'Keep the reason under 300 characters.'),
});

/** Validated local wall-clock punches → instants, with friendly errors. */
export function toInstants(b: z.infer<typeof PunchTimes>, tz: string, now = new Date()) {
  const clockIn = zonedToUtc(b.inDate, b.inTime, tz);
  const clockOut = b.outDate && b.outTime ? zonedToUtc(b.outDate, b.outTime, tz) : null;
  if ((b.outDate && !b.outTime) || (!b.outDate && b.outTime)) throw new HttpError(400, 'Enter both the clock-out date and time.');
  if (clockIn.getTime() > now.getTime() + 5 * 60000) throw new HttpError(400, 'The clock-in can’t be in the future.');
  if (clockOut && clockOut.getTime() > now.getTime() + 5 * 60000) throw new HttpError(400, 'The clock-out can’t be in the future.');
  if (clockOut && clockOut <= clockIn) throw new HttpError(400, 'Clock-out has to be after clock-in.');
  if (clockOut && clockOut.getTime() - clockIn.getTime() > 24 * 3600e3) throw new HttpError(400, 'One entry can’t be longer than 24 hours. Split it into two.');
  if (clockOut && b.breakMinutes * 60000 >= clockOut.getTime() - clockIn.getTime()) throw new HttpError(400, 'The break is longer than the time worked.');
  return { clockIn, clockOut };
}

export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Invalid input');
  return r.data;
}
