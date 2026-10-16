import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { HttpError } from '@/lib/http-error';
import { extractResumeText, MAX_RESUME_BYTES } from '@/lib/resume';
import { factsFromText } from '@/lib/resume-fill';
import { limited } from '@/lib/rate-limit';

/**
 * Reads a resume on the apply form so the applicant can check the skills, experience and title it found before
 * applying. Read on the server and thrown away: nothing is stored and nothing is sent to an AI model.
 */
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  if (await limited('resume-scan', ip, 30, 3600e3)) return Response.json({ error: 'Too many resumes from this network. Try again later, or just submit your application.' }, { status: 429 });
  const org = await db.organization.findUnique({ where: { slug: params.slug } });
  if (!org || !['trialing', 'active'].includes(org.subscriptionStatus)) return Response.json({ error: 'Not found' }, { status: 404 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('resume'), jobId = form?.get('jobId');
  if (!(file instanceof File) || !file.size) return Response.json({ error: 'Choose your resume file.' }, { status: 400 });
  if (file.size > MAX_RESUME_BYTES) return Response.json({ error: 'That file is larger than 10 MB.' }, { status: 413 });
  try {
    const text = await extractResumeText(Buffer.from(await file.arrayBuffer()), file.name);
    return Response.json({ facts: await factsFromText(tenantDb(org.id), text, typeof jobId === 'string' ? jobId : undefined) });
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: `${e.message} You can still apply — we’ll keep your resume.` }, { status: e.status });
    throw e;
  }
}
export function OPTIONS() { return new Response(null, { status: 204 }); }
