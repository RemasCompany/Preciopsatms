import { z } from 'zod';
import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { db } from '@/lib/db';
import { planIncludes } from '@/lib/plans';
import { audit, diff } from '@/lib/audit';

const Body = z.object({
  enabled: z.boolean(),
  enforcement: z.enum(['warn', 'block'], { errorMap: () => ({ message: 'Choose warn or block.' }) }),
});

/** The company's own choices: use onboarding at all, and whether unfinished onboarding warns or blocks work. */
export const PATCH = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', write: true });
  if (!planIncludes(org, 'onboarding')) throw new HttpError(402, 'Onboarding is included in the Growth and Enterprise plans.');
  const r = Body.safeParse(await req.json().catch(() => null));
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Invalid input');
  const next = { onboardingEnabled: r.data.enabled, onboardingEnforcement: r.data.enforcement };
  await db.organization.update({ where: { id: org.id }, data: next });
  await audit(org.id, user, 'settings.onboarding', r.data.enabled ? `Turned onboarding on (${r.data.enforcement})` : 'Turned onboarding off', { changes: diff(org, next), req });
  await logActivity(org.id, r.data.enabled ? `Turned onboarding on (${r.data.enforcement === 'block' ? 'unfinished onboarding blocks scheduling and clock-in' : 'unfinished onboarding shows a warning'})` : 'Turned onboarding off', user.id);
  return Response.json({ ok: true });
});
