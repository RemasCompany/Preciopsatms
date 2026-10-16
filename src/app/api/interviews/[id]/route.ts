import { requireApiContext, withApi } from '@/lib/tenant';
import { changeInterview, interviewDetail } from '@/lib/interviews-server';

type Ctx = { params: { id: string } };

export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const ctx = await requireApiContext({ feature: 'ats' });
  return Response.json(await interviewDetail(ctx, params.id));
});

/** { action: 'cancel', reason?, notify? } | { action: 'reschedule', slots, channels } | { action: 'outcome', status } */
export const PATCH = withApi(async (req: Request, { params }: Ctx) => {
  const ctx = await requireApiContext({ minRole: 'RECRUITER', feature: 'ats', write: true });
  return Response.json(await changeInterview(ctx, params.id, await req.json().catch(() => null)));
});
