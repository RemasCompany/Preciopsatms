import { requirePageContext } from '@/lib/tenant';
import { ACTIVE_STATUSES } from '@/lib/plans';
import PipelineBoard, { type BoardApp } from '@/components/PipelineBoard';

export default async function Pipeline({ searchParams }: { searchParams: { job?: string } }) {
  const { tdb, org, role } = await requirePageContext();
  const [apps, jobs, candidates] = await Promise.all([
    tdb.application.findMany({
      include: { candidate: { select: { name: true, availability: true } }, job: { select: { title: true, client: { select: { name: true } } } } },
      orderBy: { stageChangedAt: 'desc' },
    }),
    tdb.job.findMany({ select: { id: true, title: true, status: true, client: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }),
    tdb.candidate.findMany({ select: { id: true, name: true, title: true }, orderBy: { name: 'asc' }, take: 1000 }),
  ]);
  const rows: BoardApp[] = apps.map((a) => ({
    id: a.id, jobId: a.jobId, candidateId: a.candidateId, stage: a.stage, matchScore: a.matchScore, stageChangedAt: a.stageChangedAt.toISOString(),
    candidate: a.candidate.name, availability: a.candidate.availability, job: a.job.title, client: a.job.client?.name ?? null,
  }));
  const canEdit = role !== 'VIEWER' && ACTIVE_STATUSES.has(org.subscriptionStatus);
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
