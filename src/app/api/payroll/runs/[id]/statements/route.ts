import { requireApiContext, withApi, logActivity } from '@/lib/tenant';
import { statementsPdf } from '@/lib/pay-statements';

export const dynamic = 'force-dynamic';

/** Pay summaries (one page per worker) for a run, or for one worker with ?worker=candidateId. */
export const GET = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'payrollRuns' });
  const { pdf, run } = await statementsPdf(org, tdb, params.id, new URL(req.url).searchParams.get('worker'));
  await logActivity(org.id, `Downloaded pay summaries for ${run.number}`, user.id);
  return new Response(Buffer.from(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${run.number}-pay-summaries.pdf"`, 'Cache-Control': 'private, no-store' } });
});
