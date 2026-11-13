import { z } from 'zod';
import { db } from '@/lib/db';
import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { MAX_CARD_FEE_PCT } from '@/lib/invoicing';

const Body = z.object({
  onlinePayments: z.boolean().optional(),
  cardFeePct: z.number({ invalid_type_error: 'Enter the card fee as a number, like 2.9.' }).min(0, 'The card fee can’t be negative.')
    .max(MAX_CARD_FEE_PCT, `Card fees can be at most ${MAX_CARD_FEE_PCT}% (card network rules).`).optional(),
  invoiceReminders: z.boolean().optional(),
}).strict();

/** Settings → Payments: switch online payment on or off, the card fee, and automatic reminders. */
export const PATCH = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'invoicing', write: true });
  const b = Body.safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'Invalid input');
  if (b.data.onlinePayments && !(org.stripeConnectAccountId && org.stripeConnectReady)) throw new HttpError(409, 'Connect Stripe and finish its setup before turning on online payments.');
  const data = { ...b.data, ...(b.data.cardFeePct !== undefined ? { cardFeePct: Math.round(b.data.cardFeePct * 100) / 100 } : {}) };
  await db.organization.update({ where: { id: org.id }, data });
  const parts = [
    data.onlinePayments !== undefined && `online payments ${data.onlinePayments ? 'on' : 'off'}`,
    data.cardFeePct !== undefined && `card fee ${data.cardFeePct}%`,
    data.invoiceReminders !== undefined && `invoice reminders ${data.invoiceReminders ? 'on' : 'off'}`,
  ].filter(Boolean).join(', ');
  await logActivity(org.id, `Payment settings: ${parts || 'no changes'}`, user.id);
  await audit(org.id, user, 'billing.payments_settings', `Changed payment settings: ${parts || 'no changes'}`, { req });
  return Response.json({ ok: true });
});
