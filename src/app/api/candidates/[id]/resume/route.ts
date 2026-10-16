import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { getFile, putFile } from '@/lib/storage';
import { MAX_RESUME_BYTES, RESUME_TYPES } from '@/lib/resume';
import { describeFill, factsFromFile, fillFromResume } from '@/lib/resume-fill';

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

/** Read the resume already on file again and add the skills and experience it shows to the profile. */
export const PATCH = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'ats', write: true });
  const cand = await tdb.candidate.findFirst({ where: { id: params.id }, select: { id: true, name: true, resumeFileId: true } });
  if (!cand) throw new HttpError(404, 'That candidate was deleted.');
  const file = cand.resumeFileId ? await tdb.storedFile.findFirst({ where: { id: cand.resumeFileId } }) : null;
  if (!file) throw new HttpError(404, 'This candidate has no resume on file.');
  const facts = await factsFromFile(tdb, await getFile(file.key), file.filename);
  if (!facts) throw new HttpError(422, 'The resume’s text couldn’t be read. If it’s a scanned image, type the skills in.');
  const filled = await fillFromResume(tdb, cand.id, facts);
  const note = describeFill(filled);
  if (filled && (filled.addedSkills.length || filled.addedCerts.length || filled.filled.length)) await logActivity(org.id, `${cand.name}: ${note.replace(/^Added/, 'added')}`, user.id);
  return Response.json({ ok: true, filled, note });
});

/** Attach or replace the candidate's resume (multipart "file"), and add the skills and experience it shows to the profile. */
export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'ats', write: true });
  const cand = await tdb.candidate.findFirst({ where: { id: params.id }, select: { id: true, name: true } });
  if (!cand) throw new HttpError(404, 'That candidate was deleted.');
  const file = (await req.formData().catch(() => null))?.get('file');
  if (!(file instanceof File) || !file.size) throw new HttpError(400, 'Choose a resume file.');
  if (file.size > MAX_RESUME_BYTES) throw new HttpError(413, 'That file is larger than 10 MB.');
  const type = RESUME_TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''];
  if (!type || type === 'application/rtf') throw new HttpError(415, 'Upload a PDF, Word or text file.');
  const buf = Buffer.from(await file.arrayBuffer());
  const stored = await putFile(org.id, file.name, type, buf);
  await tdb.candidate.updateMany({ where: { id: cand.id }, data: { resumeFileId: stored.id } });
  const facts = await factsFromFile(tdb, buf, file.name);
  const filled = facts ? await fillFromResume(tdb, cand.id, facts) : null;
  await logActivity(org.id, `Attached a resume for ${cand.name}`, user.id);
  return Response.json({ ok: true, filename: stored.filename, filled, note: facts ? describeFill(filled) : 'The resume was saved, but its text couldn’t be read to fill in skills.' });
});
