import { requireApiContext, withApi } from '@/lib/tenant';
import { changeInterview, interviewDetail } from '@/lib/interviews-server';
import { HttpError } from '@/lib/tenant';
import { canActOnJob } from '@/lib/hiring-manager';

type Ctx = { params: { id: string } };

export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const ctx = await requireApiContext({ feature: 'ats' });
  return Response.json(await interviewDetail(ctx, params.id));
});

/** { action: 'cancel', reason?, notify? } | { action: 'reschedule', slots, channels } | { action: 'outcome', status } */
export const PATCH = withApi(async (req: Request, { params }: Ctx) => {
  // Recruiters and up, or the hiring manager for the interview's job (reschedule, cancel, record the outcome).
  const ctx = await requireApiContext({ feature: 'ats', write: true });
  const iv = await ctx.tdb.interview.findFirst({ where: { id: params.id }, select: { jobId: true } });
  if (!iv) throw new HttpError(404, 'That interview was deleted.');
  if (!(await canActOnJob(ctx, iv.jobId))) throw new HttpError(403, 'Only recruiters, HR, or this job’s hiring manager can change this interview.');
  return Response.json(await changeInterview(ctx, params.id, await req.json().catch(() => null)));
});
