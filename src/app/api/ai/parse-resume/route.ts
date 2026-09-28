import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { aiJson } from '@/lib/ai';
import { getFile } from '@/lib/storage';
import { cleanProfile, extractContact, extractResumeText, redactResume, resumePrompt } from '@/lib/resume';

/**
 * Parse a resume into a candidate profile. Send a file (multipart "file"), pasted text ({ text }), or
 * { candidateId } to parse the resume already on file. Name, email and phone are found locally and removed —
 * with links and street addresses — before the text goes to the AI model.
 */
export const POST = withApi(async (req: Request) => {
  const { tdb, org } = await requireApiContext({ minRole: 'RECRUITER', feature: 'ai' });
  let text: string;
  if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    const file = (await req.formData()).get('file');
    if (!(file instanceof File) || !file.size) throw new HttpError(400, 'Choose a resume file.');
    text = await extractResumeText(Buffer.from(await file.arrayBuffer()), file.name);
  } else {
    const b = z.union([z.object({ text: z.string().max(60000) }), z.object({ candidateId: z.string() })]).safeParse(await req.json().catch(() => ({})));
    if (!b.success) throw new HttpError(400, 'Paste the resume text or choose a file.');
    if ('text' in b.data) {
      text = b.data.text.trim();
      if (text.length < 40) throw new HttpError(400, 'Paste the full resume text.');
    } else {
      const cand = await tdb.candidate.findFirst({ where: { id: b.data.candidateId }, select: { resumeFileId: true } });
      const file = cand?.resumeFileId ? await tdb.storedFile.findFirst({ where: { id: cand.resumeFileId } }) : null;
      if (!file) throw new HttpError(404, 'This candidate has no resume on file.');
      text = await extractResumeText(await getFile(file.key), file.filename);
    }
  }
  const contact = extractContact(text);
  const ai = await aiJson<Record<string, unknown>>(org, resumePrompt(redactResume(text, contact.name)), 1500);
  return Response.json({ profile: cleanProfile(ai && typeof ai === 'object' ? ai : {}, contact) });
});
