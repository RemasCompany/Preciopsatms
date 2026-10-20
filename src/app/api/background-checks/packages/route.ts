import { requireApiContext, withApi } from '@/lib/tenant';
import { packages, screeningStatus } from '@/lib/checkr';

export const dynamic = 'force-dynamic';

/** Whether this company can order checks yet (off / not_connected / pending / ready), and its packages once it can. */
export const GET = withApi(async () => {
  const { tdb, role } = await requireApiContext({ minRole: 'RECRUITER', feature: 'credentials' });
  const s = await screeningStatus(tdb);
  return Response.json({ ...s, enabled: s.state === 'ready', admin: role === 'OWNER' || role === 'ADMIN', packages: s.state === 'ready' ? await packages(tdb) : [] });
});
