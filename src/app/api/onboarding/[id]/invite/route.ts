import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { inviteOnboarding } from '@/lib/onboarding-server';

/** Send (or resend) the new hire their private onboarding link. */
export const POST = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'onboarding', write: true });
  const r = z.object({ channels: z.array(z.enum(['email', 'sms'])).min(1, 'Choose email, text or both.').max(2) }).safeParse(await req.json().catch(() => null));
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Invalid input');
  return Response.json(await inviteOnboarding(org, user, params.id, [...new Set(r.data.channels)]));
});
