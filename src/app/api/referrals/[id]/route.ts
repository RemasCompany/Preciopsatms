import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { Decide, decide } from '@/lib/referrals';

/** Mark a referral bonus paid, not eligible, or reopen it (owners and admins). */
export const PATCH = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'engagement', write: true });
  const b = Decide.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'Invalid input');
  await decide(tdb, org, user, params.id, b.data);
  return Response.json({ ok: true });
});
