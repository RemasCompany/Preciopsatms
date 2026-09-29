import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { parseWeek } from '@/lib/weeks';
import { publishWeek, parse } from '@/lib/schedule-server';

const Body = z.object({
  week: z.string(),
  channels: z.array(z.enum(['email', 'sms'])).min(1, 'Choose email, text or both.').max(2),
  applicationIds: z.array(z.string()).max(1000).optional(),
});

/** Send each worker with unsent shifts this week one notice per channel. */
export const POST = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'scheduling', write: true });
  const b = parse(Body, await req.json().catch(() => null));
  const week = parseWeek(b.week).toISOString().slice(0, 10);
  const results = await publishWeek(org, user, week, [...new Set(b.channels)], b.applicationIds);
  if (!results.length) throw new HttpError(400, 'There’s nothing new to send for this week.');
  return Response.json({ results });
});
