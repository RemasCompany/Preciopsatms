import { z } from 'zod';
import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { putFile } from '@/lib/storage';
import { sendEmail } from '@/lib/email';
import { verifyIndeedSignature } from '@/lib/job-boards';

// Indeed Apply application payload (the parts we use). Indeed may add fields; unknown ones are ignored.
const Payload = z.object({
  id: z.string().max(200),
  job: z.object({ jobId: z.string().max(200), jobTitle: z.string().max(300).optional() }).passthrough(),
  applicant: z.object({
    fullName: z.string().trim().min(1).max(200),
    email: z.string().trim().email().max(200),
    phoneNumber: z.string().max(40).optional(),
    coverletter: z.string().max(20000).optional(),
    resume: z.object({ file: z.object({ fileName: z.string().max(200), contentType: z.string().max(120), data: z.string() }).optional() }).passthrough().optional(),
  }).passthrough(),
}).passthrough();

const RESUME_TYPES: Record<string, string> = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain' };

/**
 * Indeed Apply webhook (the indeed-apply-postUrl in the feed). Verifies X-Indeed-Signature with the org's shared
 * secret, then creates or updates the candidate, attaches the resume and adds them to the job at Applied.
 * Returns 2xx for every accepted application (including repeats) so Indeed doesn't retry; 401 on a bad signature.
 */
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const org = await db.organization.findUnique({ where: { slug: params.slug } });
  if (!org?.indeedApplySecret || !['trialing', 'active'].includes(org.subscriptionStatus)) return Response.json({ error: 'Not found' }, { status: 404 });
  const raw = await req.text();
  if (raw.length > 15_000_000) return Response.json({ error: 'Too large' }, { status: 413 });
  if (!verifyIndeedSignature(raw, req.headers.get('x-indeed-signature'), org.indeedApplySecret)) return Response.json({ error: 'Invalid signature' }, { status: 401 });

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = Payload.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'Missing applicant name, email or job' }, { status: 400 });
  const { job: j, applicant: a } = parsed.data;

  const tdb = tenantDb(org.id);
  const job = await tdb.job.findFirst({ where: { id: j.jobId } });
  if (!job) return Response.json({ error: 'Unknown job' }, { status: 404 });

  let resumeFileId: string | undefined;
  const file = a.resume?.file;
  if (file?.data) {
    const ext = file.fileName.split('.').pop()?.toLowerCase() ?? '';
    const type = RESUME_TYPES[ext] ?? file.contentType;
    try { resumeFileId = (await putFile(org.id, file.fileName, type, Buffer.from(file.data, 'base64'))).id; }
    catch (e) { console.error('[indeed-apply] resume not stored', (e as Error).message); } // still accept the application
  }

  const email = a.email.toLowerCase();
  let cand = await tdb.candidate.findFirst({ where: { email } });
  if (!cand) {
    cand = await tdb.candidate.create({ data: { name: a.fullName, email, phone: a.phoneNumber, source: 'Indeed', summary: a.coverletter, resumeFileId, smsOptOut: true } as never });
  } else {
    await tdb.candidate.updateMany({ where: { id: cand.id }, data: { ...(resumeFileId ? { resumeFileId } : {}), ...(a.phoneNumber && !cand.phone ? { phone: a.phoneNumber } : {}) } });
  }
  const existing = await tdb.application.findFirst({ where: { candidateId: cand.id, jobId: job.id } });
  if (existing) return Response.json({ ok: true, duplicate: true });
  await tdb.application.create({ data: { candidateId: cand.id, jobId: job.id, stage: 'APPLIED', maxStage: 'APPLIED' } as never });
  await db.activity.create({ data: { organizationId: org.id, text: `${a.fullName} applied to ${job.title} via Indeed` } });
  if (org.applyEmail) await sendEmail({ to: org.applyEmail, replyTo: email, subject: `New applicant from Indeed: ${a.fullName} for ${job.title}`,
    text: `${a.fullName} (${email}${a.phoneNumber ? ', ' + a.phoneNumber : ''}) applied to ${job.title} on Indeed.\n\nOpen Preciops to review: ${process.env.APP_URL}/app/pipeline?job=${job.id}` })
    .catch((e) => console.error('[indeed-apply] notification email failed', e));
  return Response.json({ ok: true });
}
