import { requireApiContext, withApi } from '@/lib/tenant';
import { pool } from '@/lib/open-shifts';

export const dynamic = 'force-dynamic';

/** Who can be offered this shift, and why anyone can't. */
export const GET = withApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org } = await requireApiContext({ minRole: 'RECRUITER', feature: 'scheduling' });
  const { workers } = await pool(tdb, org, params.id);
  return Response.json({ workers });
});
