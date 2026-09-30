import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { db } from '@/lib/db';
import { audit, diff } from '@/lib/audit';

const Body = z.object({
  bonus: z.union([z.number().min(1, 'Use at least $1, or turn the bonus off.').max(10000, 'Keep it under $10,000.'), z.null()]),
  minHours: z.number().int('Use whole hours.').min(0).max(2000, 'Keep it under 2,000 hours.'),
});

/** The referral bonus and how many hours the friend must work first. Applies to new referrals. */
export const PATCH = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'engagement', write: true });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'Invalid input');
  const next = { referralBonus: b.data.bonus, referralMinHours: b.data.minHours };
  await db.organization.update({ where: { id: org.id }, data: next });
  await audit(org.id, user, 'settings.engagement', b.data.bonus ? `Referral bonus: $${b.data.bonus} after ${b.data.minHours} hours` : 'Turned the referral bonus off',
    { changes: diff({ referralBonus: org.referralBonus == null ? null : Number(org.referralBonus), referralMinHours: org.referralMinHours }, next), req });
  return Response.json({ ok: true });
});
