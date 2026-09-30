import { requireApiContext, withApi } from '@/lib/tenant';
import { threads } from '@/lib/sms-inbox';

export const dynamic = 'force-dynamic';

/** Text conversations, most recent first. */
export const GET = withApi(async () => {
  const { tdb } = await requireApiContext({ minRole: 'RECRUITER', feature: 'messaging' });
  return Response.json({ threads: await threads(tdb) });
});
