import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { addMissing, setCycleStatus } from '@/lib/reviews';

const Body = z.union([z.object({ status: z.enum(['OPEN', 'CLOSED']) }), z.object({ addMissing: z.literal(true) })]);

/** Close or reopen a cycle, or add employees who aren't in it yet. */
export const PATCH = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireApiContext({ minRole: 'ADMIN', feature: 'reviews', write: true });
  const r = Body.safeParse(await req.json().catch(() => null));
  if (!r.success) throw new HttpError(400, 'Nothing to change.');
  if ('addMissing' in r.data) return Response.json(await addMissing(ctx, params.id));
  await setCycleStatus(ctx, params.id, r.data.status);
  return Response.json({ ok: true });
});
