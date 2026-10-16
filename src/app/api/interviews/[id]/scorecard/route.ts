import { requireApiContext, withApi } from '@/lib/tenant';
import { saveScorecard } from '@/lib/interviews-server';

/** An interviewer's scorecard: { ratings: { [area]: 1–4 }, recommendation, notes? }. */
export const POST = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireApiContext({ feature: 'ats', write: true });
  return Response.json(await saveScorecard(ctx, params.id, await req.json().catch(() => null)));
});
