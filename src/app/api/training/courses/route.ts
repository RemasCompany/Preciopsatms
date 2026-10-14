import { requireApiContext, withApi } from '@/lib/tenant';
import { saveCourse } from '@/lib/training-server';
import { FORKLIFT_TEMPLATE } from '@/lib/training';

/** Add a course. `{ template: 'forklift' }` starts from the built-in forklift course. Admins only. */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'training', write: true });
  const body = await req.json().catch(() => null);
  const c = await saveCourse(tdb, org, user, body?.template === 'forklift' ? FORKLIFT_TEMPLATE : body);
  return Response.json({ id: c.id }, { status: 201 });
});
