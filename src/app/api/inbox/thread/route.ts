import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { thread } from '@/lib/sms-inbox';

const Body = z.object({ type: z.enum(['candidate', 'contact', 'lead']).nullable(), id: z.string().nullable(), phone: z.string().max(30) });

/** One conversation (marks its incoming texts read). */
export const POST = withApi(async (req: Request) => {
  const { tdb } = await requireApiContext({ minRole: 'RECRUITER', feature: 'messaging' });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, 'Invalid input');
  return Response.json({ messages: await thread(tdb, b.data) });
});
