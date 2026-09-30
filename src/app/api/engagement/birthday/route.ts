import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { Birthday, parse } from '@/lib/engagement-server';
import { assignmentWhere } from '@/lib/schedule-server';

/** Set or clear a worker's birthday (month and day only). Only for people on assignment — never candidates. */
export const PATCH = withApi(async (req: Request) => {
  const { tdb } = await requireApiContext({ minRole: 'RECRUITER', feature: 'engagement', write: true });
  const body = await req.json().catch(() => null);
  const { candidateId } = parse(z.object({ candidateId: z.string().min(1) }), body);
  const b = parse(Birthday, body);
  if (!(await tdb.application.findFirst({ where: { candidateId, ...assignmentWhere } }))) throw new HttpError(409, 'Birthdays are only kept for people on assignment.');
  await tdb.candidate.updateMany({ where: { id: candidateId }, data: { birthMonth: b.month, birthDay: b.day } });
  return Response.json({ ok: true });
});
