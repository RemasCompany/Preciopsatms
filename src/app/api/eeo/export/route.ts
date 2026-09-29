import { requireApiContext, withApi, logActivity } from '@/lib/tenant';
import { STAGE_ORDER } from '@/lib/eeo';

const cell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
const label = (s: string) => s[0] + s.slice(1).toLowerCase();

/** Applicant flow log (one row per application) for OFCCP / EEOC record-keeping. OWNER/ADMIN only; Enterprise plan. */
// Per-user data: never pre-render or cache.
export const dynamic = 'force-dynamic';

export const GET = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'eeo' });
  const u = new URL(req.url); const jobId = u.searchParams.get('job') ?? undefined; const year = Number(u.searchParams.get('year')) || undefined;
  const apps = await tdb.application.findMany({
    where: { ...(jobId ? { jobId } : {}), ...(year ? { createdAt: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } } : {}) },
    include: { candidate: { select: { name: true } }, job: { select: { title: true } } }, orderBy: { createdAt: 'asc' },
  });
  const selfIds = await tdb.eeoSelfId.findMany({ where: { candidateId: { in: [...new Set(apps.map((a) => a.candidateId))] } } });
  const eeo = new Map(selfIds.map((s) => [s.candidateId, s]));
  const header = ['Applicant ID', 'Applicant name', 'Job ID', 'Job title', 'Applied', 'Furthest stage', 'Current stage', 'Disposition reason', 'Disposition date', 'Gender', 'Race/ethnicity', 'Veteran', 'Disability'];
  const rows = apps.map((a) => {
    const e = eeo.get(a.candidateId);
    return [a.candidateId, a.candidate.name, a.jobId, a.job.title, ymd(a.createdAt), label(STAGE_ORDER.includes(a.maxStage) ? a.maxStage : 'APPLIED'), label(a.stage),
      a.rejectionReason, a.stage === 'REJECTED' ? ymd(a.stageChangedAt) : '', e?.gender, e?.race, e?.veteran, e?.disability];
  });
  await logActivity(org.id, 'Exported the applicant flow log', user.id);
  const today = new Date().toISOString().slice(0, 10);
  return new Response([header, ...rows].map((r) => r.map(cell).join(',')).join('\n'), {
    headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="applicant-flow-log-${today}.csv"`, 'Cache-Control': 'private, no-store' },
  });
});
