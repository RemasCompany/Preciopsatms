import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { credentialJson, parseCredential, verifierNames } from '@/lib/credentials-server';
import { credentialLabel } from '@/lib/credentials';

type Ctx = { params: { id: string } };

/** A candidate's credentials, soonest expiration first. */
export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb, org } = await requireApiContext({ feature: 'credentials' });
  const cand = await tdb.candidate.findFirst({ where: { id: params.id }, select: { id: true } });
  if (!cand) throw new HttpError(404, 'That candidate was deleted.');
  const rows = await tdb.credential.findMany({ where: { candidateId: cand.id }, orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }] });
  const names = await verifierNames(org.id, rows);
  return Response.json(rows.map((c) => credentialJson(c, c.verifiedById ? names.get(c.verifiedById) ?? 'Former team member' : null)));
});

export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'credentials', write: true });
  const cand = await tdb.candidate.findFirst({ where: { id: params.id }, select: { id: true, name: true } });
  if (!cand) throw new HttpError(404, 'That candidate was deleted.');
  const data = parseCredential(await req.json().catch(() => ({})), 'create');
  const row = await tdb.credential.create({ data: { ...data, candidateId: cand.id } as never });
  await logActivity(org.id, `Added ${credentialLabel(row)} for ${cand.name}`, user.id);
  return Response.json(credentialJson(row), { status: 201 });
});
