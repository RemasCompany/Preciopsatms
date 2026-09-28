import { requireApiContext, withApi } from '@/lib/tenant';
import type { Stage } from '@prisma/client';

const ORDER: Stage[] = ['APPLIED', 'SOURCED', 'SCREENED', 'SUBMITTED', 'INTERVIEW', 'OFFER', 'PLACED'];
const reached = (s: Stage, min: Stage) => ORDER.indexOf(s) >= ORDER.indexOf(min);
const DIMENSIONS = ['gender', 'race', 'veteran', 'disability'] as const;

/** Applicant flow + adverse impact (four-fifths rule). OWNER/ADMIN only; Enterprise plan. */
export const GET = withApi(async (req: Request) => {
  const { tdb } = await requireApiContext({ minRole: 'ADMIN', feature: 'eeo' });
  const u = new URL(req.url); const jobId = u.searchParams.get('job') ?? undefined; const year = Number(u.searchParams.get('year')) || undefined;
  const apps = await tdb.application.findMany({ where: { ...(jobId ? { jobId } : {}), ...(year ? { createdAt: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } } : {}) }, select: { candidateId: true, maxStage: true, stage: true, rejectionReason: true } });
  const cands = [...new Set(apps.map((a) => a.candidateId))];
  const selfIds = await tdb.eeoSelfId.findMany({ where: { candidateId: { in: cands } } });
  const byCand = new Map(selfIds.map((s) => [s.candidateId, s]));
  const best = new Map<string, Stage>();
  for (const a of apps) { const cur = best.get(a.candidateId); if (!cur || ORDER.indexOf(a.maxStage) > ORDER.indexOf(cur)) best.set(a.candidateId, a.maxStage); }

  const report = Object.fromEntries(DIMENSIONS.map((dim) => {
    const groups = new Map<string, { applicants: number; interviewed: number; hired: number }>();
    for (const c of cands) {
      const g = byCand.get(c)?.[dim]; if (!g || g === 'Decline to self-identify') continue;
      const row = groups.get(g) ?? { applicants: 0, interviewed: 0, hired: 0 }; const s = best.get(c)!;
      row.applicants++; if (reached(s, 'INTERVIEW')) row.interviewed++; if (reached(s, 'PLACED')) row.hired++; groups.set(g, row);
    }
    const rows = [...groups].map(([group, r]) => ({ group, ...r, selectionRate: r.applicants ? r.hired / r.applicants : 0 }));
    const top = Math.max(0, ...rows.map((r) => r.selectionRate));
    return [dim, rows.map((r) => ({ ...r, impactRatio: top ? r.selectionRate / top : null, flagged: top ? r.selectionRate / top < 0.8 : false }))];
  }));
  const reasons: Record<string, number> = {};
  for (const a of apps) if (a.stage === 'REJECTED') reasons[a.rejectionReason ?? 'Missing reason'] = (reasons[a.rejectionReason ?? 'Missing reason'] ?? 0) + 1;
  return Response.json({ applicants: cands.length, selfIdRate: cands.length ? selfIds.length / cands.length : 0, report, dispositionReasons: reasons,
    note: 'An impact ratio below 0.80 signals a step to review; it is not a legal finding. Review with employment counsel.' });
});
