import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { regenerateRecovery } from '@/lib/two-step';
import { friendly, logEverywhere, throttle } from '@/lib/two-step-routes';

/** New recovery codes (the old ones stop working). Takes a current code. */
export const POST = withApi(async (req: Request) => {
  const { user } = await requireApiContext({ twoStepSetup: true });
  await throttle(user.id);
  const b = z.object({ code: z.string().trim().min(6, 'Enter the 6-digit code from your app.').max(20) }).safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, b.error.issues[0].message);
  const codes = await friendly(regenerateRecovery(user.id, b.data.code));
  await logEverywhere(user, 'auth.recovery_new', `${user.email} made new recovery codes; the old ones no longer work`, req);
  return Response.json({ ok: true, recoveryCodes: codes });
});
