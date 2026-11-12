import { requireApiContext, withApi } from '@/lib/tenant';
import { ReviewBody, reviewMatch } from '@/lib/exclusions-server';

/** Mark a possible match cleared (a different person) or confirmed (excluded). */
export const PATCH = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'credentials', write: true });
  const b = ReviewBody.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: b.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  await reviewMatch(org, user, params.id, b.data);
  return Response.json({ ok: true });
});
