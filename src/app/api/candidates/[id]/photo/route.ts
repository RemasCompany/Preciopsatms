import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { getFile } from '@/lib/storage';
import { removePhoto } from '@/lib/employee-hub';

type Ctx = { params: { id: string } };

/** A person's profile picture, for the team. */
export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb } = await requireApiContext({});
  const c = await tdb.candidate.findFirst({ where: { id: params.id }, select: { photoFileId: true } });
  const f = c?.photoFileId ? await tdb.storedFile.findFirst({ where: { id: c.photoFileId } }) : null;
  if (!f) throw new HttpError(404, 'No picture.');
  return new Response(new Uint8Array(await getFile(f.key)), { headers: { 'Content-Type': f.contentType, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
});

/** Remove a picture that isn't appropriate for a work profile. */
export const DELETE = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', write: true });
  const c = await tdb.candidate.findFirst({ where: { id: params.id }, select: { id: true, name: true, photoFileId: true } });
  if (!c) throw new HttpError(404, 'That person was deleted.');
  const r = await removePhoto(tdb, c);
  await logActivity(org.id, `Removed ${c.name}’s profile picture`, user.id);
  return Response.json(r);
});
