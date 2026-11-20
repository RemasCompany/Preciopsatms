import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { isLocalStorage, writeLocal } from '@/lib/storage';
import { MAX_VIDEO_BYTES } from '@/lib/training';

/** Development only (STORAGE_DRIVER=local): stands in for the presigned storage upload. */
export const PUT = withApi(async (req: Request) => {
  if (!isLocalStorage()) throw new HttpError(404, 'Not found');
  const { org } = await requireApiContext({ minRole: 'ADMIN', feature: 'training', write: true });
  const key = new URL(req.url).searchParams.get('key') ?? '';
  if (!key.startsWith(`${org.id}/training/`) || key.includes('..')) throw new HttpError(403, 'That upload isn’t yours.');
  const body = Buffer.from(await req.arrayBuffer());
  if (!body.length || body.length > MAX_VIDEO_BYTES) throw new HttpError(413, 'That video is too large.');
  await writeLocal(key, body);
  return Response.json({ ok: true });
});
