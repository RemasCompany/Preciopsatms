import { requireApiContext, withApi } from '@/lib/tenant';
import { postAnnouncement } from '@/lib/announcements';

/** Post an announcement to everyone or one location, optionally emailing each person a copy. */
export const POST = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'messaging', write: true });
  const r = await postAnnouncement(org, user, await req.json().catch(() => null));
  return Response.json(r, { status: r.emailed && 'queued' in r.emailed ? 202 : 200 });
});
