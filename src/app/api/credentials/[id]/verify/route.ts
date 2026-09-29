import { z } from 'zod';
import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { credentialJson } from '@/lib/credentials-server';
import { VERIFY_METHODS, credentialLabel, credentialStatus } from '@/lib/credentials';

type Ctx = { params: { id: string } };
const Body = z.object({
  method: z.enum(VERIFY_METHODS, { errorMap: () => ({ message: 'Choose how you verified it.' }) }),
  note: z.string().max(500, 'Keep the note under 500 characters.').optional().nullable(),
});

/** Record that a recruiter checked the credential at the source: who, when, how. */
export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'credentials', write: true });
  const res = Body.safeParse(await req.json().catch(() => null));
  if (!res.success) throw new HttpError(400, res.error.issues[0]?.message ?? 'Invalid input');
  const c = await tdb.credential.findFirst({ where: { id: params.id }, include: { candidate: { select: { name: true } } } });
  if (!c) throw new HttpError(404, 'That credential was deleted.');
  const s = credentialStatus({ type: c.type, number: c.number, state: c.state, expiresAt: c.expiresAt?.toISOString().slice(0, 10) ?? null, verifiedAt: null });
  if (s.state === 'expired') throw new HttpError(400, 'This credential has expired. Enter the renewed dates first, then verify the renewal.');
  if (s.state === 'incomplete') throw new HttpError(400, `${s.text} before verifying.`);
  await tdb.credential.updateMany({ where: { id: c.id }, data: { verifiedAt: new Date(), verifiedById: user.id, verifyMethod: res.data.method, verifyNote: res.data.note?.trim() || null } });
  await logActivity(org.id, `Verified ${credentialLabel(c)} for ${c.candidate.name} (${res.data.method})`, user.id);
  return Response.json(credentialJson((await tdb.credential.findFirst({ where: { id: c.id } }))!, user.name || user.email));
});

/** Undo a verification (e.g. it was recorded by mistake). */
export const DELETE = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'credentials', write: true });
  const c = await tdb.credential.findFirst({ where: { id: params.id }, include: { candidate: { select: { name: true } } } });
  if (!c) throw new HttpError(404, 'That credential was deleted.');
  await tdb.credential.updateMany({ where: { id: c.id }, data: { verifiedAt: null, verifiedById: null, verifyMethod: null, verifyNote: null } });
  await logActivity(org.id, `Cleared verification of ${credentialLabel(c)} for ${c.candidate.name}`, user.id);
  return Response.json(credentialJson((await tdb.credential.findFirst({ where: { id: c.id } }))!));
});
