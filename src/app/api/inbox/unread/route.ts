import { requireApiContext, withApi } from '@/lib/tenant';
import { unreadCount } from '@/lib/sms-inbox';

export const dynamic = 'force-dynamic';

/** How many text replies are waiting, for the inbox badge. */
export const GET = withApi(async () => {
  const { tdb } = await requireApiContext({ minRole: 'RECRUITER', feature: 'messaging' });
  return Response.json({ unread: await unreadCount(tdb) });
});
