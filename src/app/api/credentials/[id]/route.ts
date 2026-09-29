import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { IDENTITY_FIELDS, credentialJson, parseCredential } from '@/lib/credentials-server';
import { credentialLabel } from '@/lib/credentials';

type Ctx = { params: { id: string } };

/** Edit a credential. Changing its number, state, type or dates clears the verification (a renewal must be re-checked). */
export const PATCH = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'credentials', write: true });
  const before = await tdb.credential.findFirst({ where: { id: params.id }, include: { candidate: { select: { name: true } } } });
  if (!before) throw new HttpError(404, 'That credential was deleted.');
  const data = parseCredential(await req.json().catch(() => ({})), 'update');
  const same = (a: unknown, b: unknown) => (a instanceof Date ? a.getTime() : a ?? null) === (b instanceof Date ? b.getTime() : b ?? null);
  const merged = { ...before, ...data } as typeof before;
  if (merged.issuedAt && merged.expiresAt && merged.expiresAt < merged.issuedAt) throw new HttpError(400, 'The expiration date is before the issue date.');
  const changed = IDENTITY_FIELDS.filter((k) => k in data && !same(data[k], before[k]));
  if (changed.length && before.verifiedAt) Object.assign(data, { verifiedAt: null, verifiedById: null, verifyMethod: null, verifyNote: null });
  if (changed.includes('expiresAt')) data.alertedLevel = null;
  await tdb.credential.updateMany({ where: { id: before.id }, data });
  const row = (await tdb.credential.findFirst({ where: { id: before.id } }))!;
  if (changed.length && before.verifiedAt) await logActivity(org.id, `Updated ${credentialLabel(row)} for ${before.candidate.name} — needs re-verification`, user.id);
  return Response.json(credentialJson(row));
});

export const DELETE = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'credentials', write: true });
  const row = await tdb.credential.findFirst({ where: { id: params.id }, include: { candidate: { select: { name: true } } } });
  if (!row) throw new HttpError(404, 'That credential was deleted.');
  await tdb.credential.deleteMany({ where: { id: row.id } });
  await logActivity(org.id, `Removed ${credentialLabel(row)} for ${row.candidate.name}`, user.id);
  return Response.json({ ok: true });
});
