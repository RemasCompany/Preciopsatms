import { z } from 'zod';
import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { db } from '@/lib/db';

const Body = z.object({
  userId: z.string().min(1, 'Choose a rep.'),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month.'),
  amount: z.union([z.number(), z.null()]).refine((n) => n === null || (Number.isFinite(n) && n >= 0 && n < 1e10), 'Enter a target of $0 or more.'),
}, { invalid_type_error: 'Invalid input' });

/** Sets (or, with amount null or 0, clears) one rep's revenue target for one month. Admins only. */
export const PUT = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'crm', write: true });
  const res = Body.safeParse(await req.json().catch(() => null));
  if (!res.success) throw new HttpError(400, res.error.issues[0]?.message ?? 'Invalid input');
  const { userId, month, amount } = res.data;
  const member = await db.membership.findFirst({ where: { organizationId: org.id, userId }, include: { user: { select: { name: true, email: true } } } });
  if (!member) throw new HttpError(400, 'That person isn’t on your team.');
  const monthDate = new Date(`${month}-01T00:00:00Z`);
  const where = { userId, month: monthDate };
  if (!amount) {
    await tdb.salesTarget.deleteMany({ where });
  } else {
    const amt = amount.toFixed(2);
    // upsert is blocked on tenantDb; the unique (org, user, month) index keeps this to one row.
    const n = await tdb.salesTarget.updateMany({ where, data: { amount: amt } });
    if (!n.count) {
      try { await tdb.salesTarget.create({ data: { ...where, amount: amt } as never }); }
      catch (e) { if ((e as { code?: string }).code === 'P2002') await tdb.salesTarget.updateMany({ where, data: { amount: amt } }); else throw e; }
    }
  }
  await logActivity(org.id, `Set ${member.user.name || member.user.email}’s ${month} sales target to ${amount ? `$${amount.toLocaleString('en-US')}` : 'none'}`, user.id);
  return Response.json({ ok: true });
});
