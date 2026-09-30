import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { ReplyBody, reply } from '@/lib/sms-inbox';

/** Reply by text. */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'messaging', write: true });
  const b = ReplyBody.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'Invalid input');
  await reply(tdb, org.id, user, b.data);
  return Response.json({ ok: true });
});
