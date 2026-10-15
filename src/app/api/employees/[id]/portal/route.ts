import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { sendClockLink } from '@/lib/timeclock-server';

const Body = z.object({ channels: z.array(z.enum(['email', 'sms'])).min(1, 'Choose email, text or both.') });

/** Send an employee their private page: schedule, time clock, time off, pay summaries, documents. Replaces any earlier link. */
export const POST = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'people', write: true });
  const r = Body.safeParse(await req.json().catch(() => null));
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Choose how to send it.');
  const e = await tdb.employee.findFirst({ where: { id: params.id } });
  if (!e) throw new HttpError(404, 'That employee was deleted.');
  if (e.status === 'TERMINATED') throw new HttpError(409, 'Their employment has ended.');
  return Response.json(await sendClockLink(org, user, e.candidateId, r.data.channels, { employee: true }));
});
