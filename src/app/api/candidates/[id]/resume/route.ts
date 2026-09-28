import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { getFile, putFile } from '@/lib/storage';
import { MAX_RESUME_BYTES, RESUME_TYPES } from '@/lib/resume';

type Ctx = { params: { id: string } };

/** Download the candidate's resume after checking the candidate belongs to the caller's org. */
export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb } = await requireApiContext({ feature: 'ats' });
  const cand = await tdb.candidate.findFirst({ where: { id: params.id }, select: { resumeFileId: true } });
  const file = cand?.resumeFileId ? await tdb.storedFile.findFirst({ where: { id: cand.resumeFileId } }) : null;
  if (!file) throw new HttpError(404, 'No resume on file.');
  const name = file.filename.replace(/[^\w .()-]/g, '_');
  return new Response(new Uint8Array(await getFile(file.key)), { headers: { 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
});

/** Attach or replace the candidate's resume (multipart "file"). */
export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'ats', write: true });
  const cand = await tdb.candidate.findFirst({ where: { id: params.id }, select: { id: true, name: true } });
  if (!cand) throw new HttpError(404, 'That candidate was deleted.');
  const file = (await req.formData().catch(() => null))?.get('file');
  if (!(file instanceof File) || !file.size) throw new HttpError(400, 'Choose a resume file.');
  if (file.size > MAX_RESUME_BYTES) throw new HttpError(413, 'That file is larger than 10 MB.');
  const type = RESUME_TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''];
  if (!type || type === 'application/rtf') throw new HttpError(415, 'Upload a PDF, Word or text file.');
  const stored = await putFile(org.id, file.name, type, Buffer.from(await file.arrayBuffer()));
  await tdb.candidate.updateMany({ where: { id: cand.id }, data: { resumeFileId: stored.id } });
  await logActivity(org.id, `Attached a resume for ${cand.name}`, user.id);
  return Response.json({ ok: true, filename: stored.filename });
});
