import { requireApiContext, withApi } from '@/lib/tenant';
import { checkrEnabled, packages } from '@/lib/checkr';

export const dynamic = 'force-dynamic';

/** Checkr packages this account can order, or { enabled: false } when Checkr isn't configured. */
export const GET = withApi(async () => {
  await requireApiContext({ minRole: 'RECRUITER', feature: 'credentials' });
  if (!checkrEnabled()) return Response.json({ enabled: false, packages: [] });
  return Response.json({ enabled: true, packages: await packages() });
});
