import { z } from 'zod';
import { HttpError } from '@/lib/tenant';
import { resolveWorkerLink } from '@/lib/schedule-server';
import { removeDocFile, uploadDoc } from '@/lib/hiring-docs-server';
import { limited } from '@/lib/rate-limit';

type Ctx = { params: { token: string } };
const gone = () => Response.json({ error: 'This link has expired. Ask your recruiter to send it again.' }, { status: 404 });
const fail = (e: unknown) => {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e); return Response.json({ error: 'That didn’t go through. Try again.' }, { status: 500 });
};

/** The candidate sends a file for a document they were asked for (multipart: docId, file). */
export async function POST(req: Request, { params }: Ctx) {
  if (await limited('docs', params.token.slice(0, 20), 40, 600e3)) return Response.json({ error: 'Too many uploads. Wait a few minutes and try again.' }, { status: 429 });
  const link = await resolveWorkerLink(params.token);
  if (!link) return gone();
  const form = await req.formData().catch(() => null);
  const docId = form?.get('docId'), file = form?.get('file');
  if (typeof docId !== 'string' || !(file instanceof File)) return Response.json({ error: 'Choose a file.' }, { status: 400 });
  try { return Response.json(await uploadDoc(link, docId, file)); } catch (e) { return fail(e); }
}

/** Take back a file sent by mistake: { docId, fileId }. */
export async function DELETE(req: Request, { params }: Ctx) {
  const link = await resolveWorkerLink(params.token);
  if (!link) return gone();
  const b = z.object({ docId: z.string(), fileId: z.string() }).safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: 'Choose a file.' }, { status: 400 });
  try { return Response.json(await removeDocFile(link, b.data.docId, b.data.fileId)); } catch (e) { return fail(e); }
}
