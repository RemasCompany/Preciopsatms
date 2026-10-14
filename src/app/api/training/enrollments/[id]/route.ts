import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { cancel, evaluate, resend } from '@/lib/training-server';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('evaluate') }).passthrough(),
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('resend'), channels: z.array(z.enum(['sms', 'email'])).max(2) }),
]);

/** Record the hands-on evaluation, cancel the training, or send a new link. */
export const PATCH = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'training', write: true });
  const raw = await req.json().catch(() => null);
  const b = Body.safeParse(raw);
  if (!b.success) throw new HttpError(400, 'Unknown action.');
  if (b.data.action === 'evaluate') return Response.json(await evaluate(org, user, params.id, raw));
  if (b.data.action === 'resend') return Response.json(await resend(org, user, params.id, b.data.channels));
  await cancel(org, user, params.id);
  return Response.json({ ok: true });
});
