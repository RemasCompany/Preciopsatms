import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { INLINE_MAX, SendBody, queueBulk, sendBulk, summary } from '@/lib/bulk-messaging';

/**
 * Sends individually merged messages (never one BCC blast) and logs each one. Honors opt-outs.
 * Up to 25 recipients are sent right away; larger lists are queued and the answer is 202 with a task to follow.
 */
export const POST = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'messaging', write: true });
  const p = SendBody.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? 'Invalid input');
  const b = { ...p.data, recipientIds: [...new Set(p.data.recipientIds)] };
  if (b.channel === 'email' && !b.subject?.trim()) throw new HttpError(400, 'Add a subject.');
  if (b.recipientIds.length > INLINE_MAX) {
    const task = await queueBulk(org.id, user.id, b);
    return Response.json({ queued: true, taskId: task.id, total: b.recipientIds.length }, { status: 202 });
  }
  const results = await sendBulk(org, user, b);
  await logActivity(org.id, summary(b, results), user.id);
  return Response.json(results);
});
