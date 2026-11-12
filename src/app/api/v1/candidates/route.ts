import { apiRoute, page, paged } from '@/lib/api-keys';
import { candidateOut, createCandidate, since } from '@/lib/api-v1';
import { logActivity } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

/** GET /api/v1/candidates?email=&updatedSince=…&limit=&cursor= */
export const GET = apiRoute(async (req, { tdb }) => {
  const { limit, after, args, u } = page(req);
  const email = u.searchParams.get('email')?.trim();
  const rows = await tdb.candidate.findMany({ ...args, where: { ...after, ...since(u), ...(email ? { email: { equals: email, mode: 'insensitive' as const } } : {}) } });
  const { data, nextCursor } = paged(rows, limit);
  return Response.json({ data: data.map(candidateOut), nextCursor });
});

/** POST /api/v1/candidates — adds a candidate (409 if one with that email already exists). */
export const POST = apiRoute(async (req, { org, tdb }) => {
  const c = await createCandidate(tdb, await req.json().catch(() => null));
  await logActivity(org.id, `Candidate ${c.name} added through the API`);
  return Response.json(candidateOut(c), { status: 201 });
});
