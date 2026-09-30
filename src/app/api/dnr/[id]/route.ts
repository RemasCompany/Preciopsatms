import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { liftDnr } from '@/lib/dnr';

/** Lift a do-not-return entry (owners and admins, with a reason; it stays on record). */
export const DELETE = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', write: true });
  const b = z.object({ reason: z.string().trim().min(3, 'Say why it’s being lifted.').max(300) }).safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'Invalid input');
  await liftDnr(tdb, org, user, params.id, b.data.reason);
  return Response.json({ ok: true });
});
