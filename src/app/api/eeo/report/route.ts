import { requireApiContext, withApi } from '@/lib/tenant';
import { buildEeoReport } from '@/lib/eeo';

/** Applicant flow + adverse impact (four-fifths rule). OWNER/ADMIN only; Enterprise plan. */
export const GET = withApi(async (req: Request) => {
  const { tdb } = await requireApiContext({ minRole: 'ADMIN', feature: 'eeo' });
  const u = new URL(req.url);
  return Response.json(await buildEeoReport(tdb, { jobId: u.searchParams.get('job') ?? undefined, year: Number(u.searchParams.get('year')) || undefined }));
});
