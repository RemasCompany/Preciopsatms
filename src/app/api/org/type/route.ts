import { z } from 'zod';
import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { db } from '@/lib/db';
import { audit } from '@/lib/audit';
import { syncSeats } from '@/lib/stripe';

const Body = z.object({
  kind: z.enum(['STAFFING', 'EMPLOYER'], { errorMap: () => ({ message: 'Choose staffing agency or employer.' }) }),
  hrEnabled: z.boolean().optional(),
});

/**
 * Staffing agency or employer. It changes the menus, wording and which features show (nothing is deleted), and
 * for a paid subscription the price: employers are billed per active employee.
 */
export const PATCH = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'OWNER', write: true });
  const r = Body.safeParse(await req.json().catch(() => null));
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Invalid input');
  const next = { kind: r.data.kind, hrEnabled: r.data.hrEnabled ?? org.hrEnabled };
  if (next.kind === org.kind && next.hrEnabled === org.hrEnabled) return Response.json({ ok: true });
  await db.organization.update({ where: { id: org.id }, data: next });
  const what = next.kind !== org.kind ? `Changed the company type to ${next.kind === 'EMPLOYER' ? 'employer' : 'staffing agency'}` : next.hrEnabled ? 'Turned on employee records for internal staff' : 'Turned off employee records for internal staff';
  await audit(org.id, user, 'settings.company_type', what, { changes: { kind: [org.kind, next.kind], hrEnabled: [org.hrEnabled, next.hrEnabled] }, req });
  await logActivity(org.id, what, user.id);
  await syncSeats(org.id).catch((e) => console.error('[org/type] billing sync failed', e));
  return Response.json({ ok: true });
});
