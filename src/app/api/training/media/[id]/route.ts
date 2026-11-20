import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { serveMedia } from '@/lib/training-media';

/** Plays an uploaded training video or its captions for the team (course preview). */
export const GET = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb } = await requireApiContext({ feature: 'training' });
  const f = await tdb.storedFile.findFirst({ where: { id: params.id } });
  if (!f || !(f.contentType.startsWith('video/') || f.contentType === 'text/vtt')) throw new HttpError(404, 'That video was deleted.');
  return serveMedia(f, req.headers.get('range'));
});
