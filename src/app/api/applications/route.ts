import { z } from 'zod';
import { Stage } from '@prisma/client';
import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { START_STAGES } from '@/lib/pipeline';
import { assertNotBarred } from '@/lib/dnr';

const Body = z.object({
  jobId: z.string().min(1, 'Choose a job'),
  candidateId: z.string().min(1, 'Choose a candidate'),
  stage: z.nativeEnum(Stage).refine((s) => START_STAGES.includes(s), 'Choose a starting stage').default('SOURCED'),
});

/** Add a candidate to a job's pipeline. */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', write: true });
  const b = Body.parse(await req.json());
  const [job, cand] = await Promise.all([tdb.job.findFirst({ where: { id: b.jobId } }), tdb.candidate.findFirst({ where: { id: b.candidateId } })]);
  if (!job) throw new HttpError(404, 'Job not found');
  if (!cand) throw new HttpError(404, 'Candidate not found');
  if (await tdb.application.findFirst({ where: { jobId: job.id, candidateId: cand.id } })) throw new HttpError(409, 'Already in this job’s pipeline.');
  if (job.clientId) await assertNotBarred(tdb, cand, job.clientId, (await tdb.client.findFirst({ where: { id: job.clientId }, select: { name: true } }))?.name);
  else await assertNotBarred(tdb, cand, null);
  const app = await tdb.application.create({ data: { jobId: job.id, candidateId: cand.id, stage: b.stage, maxStage: b.stage } as never });
  await logActivity(org.id, `${cand.name} added to ${job.title} at ${b.stage.toLowerCase()}`, user.id);
  return Response.json({ id: app.id }, { status: 201 });
});
