import { requireApiContext, withApi } from '@/lib/tenant';
import { buildEeoReport } from '@/lib/eeo';
import { audit } from '@/lib/audit';

/** Applicant flow + adverse impact (four-fifths rule). OWNER/ADMIN only; Enterprise plan. */
// Per-user data: never pre-render or cache.
export const dynamic = 'force-dynamic';

export const GET = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'eeo' });
  const u = new URL(req.url);
  const jobId = u.searchParams.get('job') ?? undefined, year = Number(u.searchParams.get('year')) || undefined;
  await audit(org.id, user, 'eeo.report_view', `Viewed the EEO report${year ? ` for ${year}` : ''}${jobId ? ' for one job' : ''}`, { targetType: jobId ? 'job' : undefined, targetId: jobId, req });
  return Response.json(await buildEeoReport(tdb, { jobId, year }));
});
