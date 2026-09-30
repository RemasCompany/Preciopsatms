import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { AddBody, addDnr } from '@/lib/dnr';

/** A candidate's do-not-return entries (active and lifted). */
export const GET = withApi(async (req: Request) => {
  const { tdb } = await requireApiContext({ minRole: 'RECRUITER' });
  const candidateId = new URL(req.url).searchParams.get('candidate') ?? '';
  const rows = await tdb.doNotReturn.findMany({ where: { candidateId }, orderBy: { createdAt: 'desc' } });
  const clients = new Map((await tdb.client.findMany({ where: { id: { in: rows.map((r) => r.clientId).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  return Response.json(rows.map((r) => ({ id: r.id, client: r.clientId ? clients.get(r.clientId) ?? 'Deleted client' : null, reason: r.reason, source: r.source, createdAt: r.createdAt, liftedAt: r.liftedAt, liftReason: r.liftReason })));
});

/** Put a candidate on a client's (or the company-wide) do-not-return list. */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', write: true });
  const b = AddBody.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'Invalid input');
  const d = await addDnr(tdb, org, user, b.data);
  return Response.json({ id: d.id }, { status: 201 });
});
