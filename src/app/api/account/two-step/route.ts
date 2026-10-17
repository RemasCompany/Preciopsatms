import { z } from 'zod';
import { db } from '@/lib/db';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { friendly, logEverywhere, throttle } from '@/lib/two-step-routes';
import { beginSetup, confirmSetup, disable, status } from '@/lib/two-step';

const Code = z.object({ code: z.string().trim().min(6, 'Enter the 6-digit code from your app.').max(20, 'That code is too long.') });

// Personal security settings: they work on any plan and even while billing is inactive, and before the company's
// two-step requirement is met (that's how people meet it).
const me = () => requireApiContext({ twoStepSetup: true });
export const GET = withApi(async () => {
  const { user } = await me();
  return Response.json(await status(user.id));
});

/** Step 1: a new secret and its QR code (also for moving to a new phone). Not in force until confirmed. */
export const POST = withApi(async () => {
  const { user } = await me();
  return Response.json(await beginSetup(user));
});

/** Step 2: the first code from the app turns it on; the recovery codes come back once. */
export const PUT = withApi(async (req: Request) => {
  const { user } = await me();
  await throttle(user.id);
  const b = Code.extend({ pending: z.string().min(10).max(2000), proof: z.string().trim().max(20).optional() }).safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, b.error.issues[0].message);
  const moving = !!user.totpEnabledAt;
  const codes = await friendly(confirmSetup(user.id, b.data.pending, b.data.code, b.data.proof));
  await logEverywhere(user, 'auth.two_step_on', moving ? `${user.email} moved two-step sign-in to a new phone` : `${user.email} turned on two-step sign-in`, req);
  return Response.json({ ok: true, recoveryCodes: codes });
});

/** Turning it off takes a current code (or a recovery code). Blocked where the company requires it. */
export const DELETE = withApi(async (req: Request) => {
  const { user } = await me();
  await throttle(user.id);
  const b = Code.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, b.error.issues[0].message);
  const strict = await db.membership.findFirst({ where: { userId: user.id, organization: { requireTwoStep: true } }, select: { organization: { select: { name: true } } } });
  if (strict) throw new HttpError(409, `${strict.organization.name} requires two-step sign-in, so it can’t be turned off. To move it to a new phone, make new recovery codes or ask an admin to reset it.`);
  await friendly(disable(user.id, b.data.code));
  await logEverywhere(user, 'auth.two_step_off', `${user.email} turned off two-step sign-in`, req);
  return Response.json({ ok: true });
});
