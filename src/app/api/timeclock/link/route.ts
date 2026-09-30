import { z } from 'zod';
import { requireApiContext, withApi } from '@/lib/tenant';
import { sendClockLink } from '@/lib/timeclock-server';
import { parseBody } from '@/lib/timeclock-schemas';

/** Send a worker their private time clock link by email and/or text (replaces any earlier link). */
export const POST = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'timeclock', write: true });
  const b = parseBody(z.object({ candidateId: z.string().min(1), channels: z.array(z.enum(['email', 'sms'])).min(1, 'Choose email, text or both.').max(2) }), await req.json().catch(() => null));
  return Response.json(await sendClockLink(org, user, b.candidateId, [...new Set(b.channels)]));
});
