import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { getFile, putFile } from '@/lib/storage';
import { credentialLabel } from '@/lib/credentials';

type Ctx = { params: { id: string } };
const TYPES: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const MAX = 10 * 1024 * 1024;

/** Download the proof on file (license card, certificate, lab result) after checking it belongs to this org. */
export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb } = await requireApiContext({ feature: 'credentials' });
  const c = await tdb.credential.findFirst({ where: { id: params.id }, select: { fileId: true } });
  const file = c?.fileId ? await tdb.storedFile.findFirst({ where: { id: c.fileId } }) : null;
  if (!file) throw new HttpError(404, 'No document on file.');
  const name = file.filename.replace(/[^\w .()-]/g, '_');
  return new Response(new Uint8Array(await getFile(file.key)), { headers: { 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
});

/** Attach or replace the proof (multipart "file"): PDF or a photo. */
export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'credentials', write: true });
  const c = await tdb.credential.findFirst({ where: { id: params.id }, include: { candidate: { select: { name: true } } } });
  if (!c) throw new HttpError(404, 'That credential was deleted.');
  const file = (await req.formData().catch(() => null))?.get('file');
  if (!(file instanceof File) || !file.size) throw new HttpError(400, 'Choose a file.');
  if (file.size > MAX) throw new HttpError(413, 'That file is larger than 10 MB.');
  const type = TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''];
  if (!type) throw new HttpError(415, 'Upload a PDF or a photo (JPG or PNG).');
  const stored = await putFile(org.id, file.name, type, Buffer.from(await file.arrayBuffer()));
  await tdb.credential.updateMany({ where: { id: c.id }, data: { fileId: stored.id } });
  await logActivity(org.id, `Attached proof of ${credentialLabel(c)} for ${c.candidate.name}`, user.id);
  return Response.json({ ok: true, filename: stored.filename });
});
