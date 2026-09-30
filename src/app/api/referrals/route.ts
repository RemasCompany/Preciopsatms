import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { refer } from '@/lib/referrals';

/** Staff record a referral on a worker's behalf (e.g. told in person). */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'engagement', write: true });
  const raw = await req.json().catch(() => null);
  const who = z.object({ referrerId: z.string().min(1, 'Choose who referred them.') }).safeParse(raw);
  if (!who.success) throw new HttpError(400, who.error.issues[0].message);
  const referrer = await tdb.candidate.findFirst({ where: { id: who.data.referrerId }, select: { id: true, name: true } });
  if (!referrer) throw new HttpError(404, 'That worker was deleted.');
  return Response.json(await refer(org, referrer, raw, user), { status: 201 });
});
