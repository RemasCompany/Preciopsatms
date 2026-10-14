import { requireApiContext, withApi } from '@/lib/tenant';
import { removeCourse, saveCourse } from '@/lib/training-server';

type Ctx = { params: { id: string } };

export const PATCH = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'training', write: true });
  await saveCourse(tdb, org, user, await req.json().catch(() => null), params.id);
  return Response.json({ ok: true });
});

/** Deletes an unused course; a course with training records is archived instead. */
export const DELETE = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'training', write: true });
  return Response.json(await removeCourse(tdb, org, user, params.id));
});
