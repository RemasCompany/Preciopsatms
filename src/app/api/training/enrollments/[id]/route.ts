import { z } from 'zod';
import { requireApiContext, withApi, HttpError, tenantDb } from '@/lib/tenant';
import { cancel, evaluate, resend } from '@/lib/training-server';
import { decideTrainingRequest } from '@/lib/employee-hub';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('evaluate') }).passthrough(),
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('decline') }),
  z.object({ action: z.literal('resend'), channels: z.array(z.enum(['sms', 'email'])).max(2) }),
]);

/** Record the hands-on evaluation, cancel the training, send a new link, or answer an employee's request to take it. */
export const PATCH = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'training', write: true });
  const raw = await req.json().catch(() => null);
  const b = Body.safeParse(raw);
  if (!b.success) throw new HttpError(400, 'Unknown action.');
  if (b.data.action === 'evaluate') return Response.json(await evaluate(org, user, params.id, raw));
  if (b.data.action === 'approve' || b.data.action === 'decline') return Response.json(await decideTrainingRequest(tenantDb(org.id), org, user, params.id, b.data.action === 'approve'));
  if (b.data.action === 'resend') return Response.json(await resend(org, user, params.id, b.data.channels));
  await cancel(org, user, params.id);
  return Response.json({ ok: true });
});
