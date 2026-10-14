import { requireApiContext, withApi } from '@/lib/tenant';
import { saveCourse } from '@/lib/training-server';
import { TEMPLATES, isTemplate } from '@/lib/training-templates';

/** Add a course. `{ template: 'forklift' | 'scissor' | 'boom' | 'crane' }` starts from a built-in course. Admins only. */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'training', write: true });
  const body = await req.json().catch(() => null);
  const t: unknown = body?.template;
  const c = await saveCourse(tdb, org, user, isTemplate(t) ? TEMPLATES[t].course : body);
  return Response.json({ id: c.id }, { status: 201 });
});
