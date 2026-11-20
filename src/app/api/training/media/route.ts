import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { completeUpload, startUpload, uploadCaption } from '@/lib/training-media';

/**
 * Training media, admins only.
 * JSON { action: 'start', filename, size } → where to upload the video (straight to storage);
 * JSON { action: 'complete', key, filename } → checks the upload and records it.
 * Multipart "file" → a captions file (.vtt or .srt).
 */
export const POST = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'training', write: true });
  if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    const file = (await req.formData().catch(() => null))?.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'Choose a captions file.');
    return Response.json(await uploadCaption(org, file), { status: 201 });
  }
  const body = await req.json().catch(() => null);
  if (body?.action === 'start') return Response.json(await startUpload(org, body));
  if (body?.action === 'complete') return Response.json(await completeUpload(org, user, body), { status: 201 });
  throw new HttpError(400, 'Invalid input');
});
