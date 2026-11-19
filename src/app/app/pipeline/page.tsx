import { requirePageContext } from '@/lib/tenant';
import { ACTIVE_STATUSES } from '@/lib/plans';
import PipelineBoard, { type BoardApp } from '@/components/PipelineBoard';
import { scoreApplications } from '@/lib/match-server';
import { appInBranch, currentBranch, jobInBranch } from '@/lib/branches';
import { managedJobIds } from '@/lib/hiring-manager';

export default async function Pipeline({ searchParams }: { searchParams: { job?: string } }) {
  const ctx = await requirePageContext();
  const { tdb, org, role } = ctx;
  const { branch } = await currentBranch(ctx);
  const [apps, jobs, candidates] = await Promise.all([
    tdb.application.findMany({
      where: appInBranch(branch),
      include: { candidate: { select: { name: true, availability: true, email: true, phone: true, emailOptOut: true, smsOptOut: true } }, job: { select: { title: true, client: { select: { name: true } } } }, _count: { select: { notes: true } } },
      orderBy: { stageChangedAt: 'desc' },
    }),
    tdb.job.findMany({ where: jobInBranch(branch), select: { id: true, title: true, status: true, client: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }),
    tdb.candidate.findMany({ select: { id: true, name: true, title: true }, orderBy: { name: 'asc' }, take: 1000 }),
  ]);
  // Scores are worked out live, so they follow edits to the job or the candidate's profile.
  const scores = await scoreApplications(tdb, apps);
  const canEdit = role !== 'VIEWER' && ACTIVE_STATUSES.has(org.subscriptionStatus);
  // A hiring manager (Viewer role) works the applicants for their own jobs: notes, stage moves, interviews.
  const managed = role === 'VIEWER' && ACTIVE_STATUSES.has(org.subscriptionStatus) ? await managedJobIds(tdb, ctx.user) : null;
  const rows: BoardApp[] = apps.map((a) => ({
    id: a.id, jobId: a.jobId, candidateId: a.candidateId, stage: a.stage, matchScore: scores.get(a.id) ?? null, stageChangedAt: a.stageChangedAt.toISOString(),
    candidate: a.candidate.name, availability: a.candidate.availability, job: a.job.title, client: a.job.client?.name ?? null,
    canAct: canEdit || !!managed?.has(a.jobId), notes: a._count.notes,
    reach: { email: !!a.candidate.email && !a.candidate.emailOptOut, phone: !!a.candidate.phone && !a.candidate.smsOptOut },
  }));
  return (
    <>
      <h1>Pipeline</h1>
      <p className="lede"><span className="mouse-only">Drag candidates between stages.</span><span className="touch-only">Use “Move to” on a card to change its stage.</span> Moving someone to Placed marks them on assignment and closes the job once every seat is filled.</p>
      <PipelineBoard
        apps={rows}
        jobs={jobs.map((j) => ({ id: j.id, title: j.title, client: j.client?.name ?? null, open: j.status === 'OPEN' }))}
        candidates={candidates.map((c) => ({ id: c.id, name: c.name, title: c.title }))}
        initialJob={searchParams.job ?? ''}
        canEdit={canEdit}
      />
    </>
  );
}
