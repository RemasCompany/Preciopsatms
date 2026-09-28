import { z } from 'zod';
import { Stage } from '@prisma/client';
import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { STAGE_ORDER as ORDER } from '@/lib/eeo';
import { REJECTION_REASONS } from '@/lib/pipeline';

const Body = z.object({ stage: z.nativeEnum(Stage), rejectionReason: z.enum(REJECTION_REASONS).optional() });

/** Move an application through the pipeline. Placing someone auto-fills the job when every opening is filled. */
export const PATCH = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', write: true });
  const { stage, rejectionReason } = Body.parse(await req.json());
  if (stage === 'REJECTED' && !rejectionReason) throw new HttpError(400, 'A rejection reason is required for EEO record-keeping');
  const app = await tdb.application.findFirst({ where: { id: params.id }, include: { candidate: true, job: true } });
  if (!app) throw new HttpError(404, 'Not found');
  if (app.stage === stage) return Response.json({ ok: true });

  const maxStage = stage !== 'REJECTED' && ORDER.indexOf(stage) > ORDER.indexOf(app.maxStage) ? stage : app.maxStage;
  await tdb.application.updateMany({ where: { id: app.id }, data: { stage, maxStage, rejectionReason: stage === 'REJECTED' ? rejectionReason : null, stageChangedAt: new Date() } });
  await logActivity(org.id, `${app.candidate.name} moved to ${stage.toLowerCase()} for ${app.job.title}`, user.id);

  if (stage === 'PLACED') {
    await tdb.candidate.updateMany({ where: { id: app.candidateId }, data: { status: 'On assignment' } });
    const placed = await tdb.application.count({ where: { jobId: app.jobId, stage: 'PLACED' } });
    if (placed >= app.job.openings && app.job.status === 'OPEN') {
      await tdb.job.updateMany({ where: { id: app.jobId }, data: { status: 'FILLED' } });
      await logActivity(org.id, `${app.job.title} is fully filled`, user.id);
    }
  }
  return Response.json({ ok: true });
});
