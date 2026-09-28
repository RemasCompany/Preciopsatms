import { requireApiContext, withApi } from '@/lib/tenant';
import { EEO_DIMENSIONS, adverseImpact, bestStageByCandidate } from '@/lib/eeo';

/** Applicant flow + adverse impact (four-fifths rule). OWNER/ADMIN only; Enterprise plan. */
export const GET = withApi(async (req: Request) => {
  const { tdb } = await requireApiContext({ minRole: 'ADMIN', feature: 'eeo' });
  const u = new URL(req.url); const jobId = u.searchParams.get('job') ?? undefined; const year = Number(u.searchParams.get('year')) || undefined;
  const apps = await tdb.application.findMany({ where: { ...(jobId ? { jobId } : {}), ...(year ? { createdAt: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } } : {}) }, select: { candidateId: true, maxStage: true, stage: true, rejectionReason: true } });
  const cands = [...new Set(apps.map((a) => a.candidateId))];
  const selfIds = await tdb.eeoSelfId.findMany({ where: { candidateId: { in: cands } } });
  const byCand = new Map(selfIds.map((s) => [s.candidateId, s]));
  const best = bestStageByCandidate(apps);
  const report = Object.fromEntries(EEO_DIMENSIONS.map((dim) => [dim, adverseImpact(cands, byCand, best, dim)]));
  const reasons: Record<string, number> = {};
  for (const a of apps) if (a.stage === 'REJECTED') reasons[a.rejectionReason ?? 'Missing reason'] = (reasons[a.rejectionReason ?? 'Missing reason'] ?? 0) + 1;
  return Response.json({ applicants: cands.length, selfIdRate: cands.length ? selfIds.length / cands.length : 0, report, dispositionReasons: reasons,
    note: 'An impact ratio below 0.80 signals a step to review; it is not a legal finding. Review with employment counsel.' });
});
