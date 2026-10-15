import { resolveWorkerLink } from '@/lib/schedule-server';
import { tenantDb } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { statementsPdf } from '@/lib/pay-statements';
import { limited } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** The employee's own pay summary for an approved or paid run (just their page). */
export async function GET(req: Request, { params }: { params: { token: string } }) {
  if (await limited('me-stub', params.token.slice(0, 20), 30, 600e3)) return Response.json({ error: 'Too many requests. Try again in a few minutes.' }, { status: 429 });
  const link = await resolveWorkerLink(params.token);
  const runId = new URL(req.url).searchParams.get('run') ?? '';
  if (!link || !hasFeature(link.organization, 'people')) return Response.json({ error: 'This link has expired.' }, { status: 404 });
  const tdb = tenantDb(link.organizationId);
  const mine = await tdb.payrollItem.findFirst({ where: { runId, candidateId: link.candidateId, run: { status: { in: ['APPROVED', 'PAID'] } } } });
  if (!mine || !(await tdb.employee.findFirst({ where: { candidateId: link.candidateId } }))) return Response.json({ error: 'That pay summary isn’t available.' }, { status: 404 });
  const { pdf, run } = await statementsPdf(link.organization, tdb, runId, link.candidateId);
  return new Response(Buffer.from(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="pay-${run.number}.pdf"`, 'Cache-Control': 'private, no-store' } });
}
