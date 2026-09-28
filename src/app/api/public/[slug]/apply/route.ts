import { z } from 'zod';
import { cleanEeoAnswer } from '@/lib/eeo';
import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { putFile } from '@/lib/storage';
import { sendEmail } from '@/lib/email';

const Fields = z.object({
  jobId: z.string(), name: z.string().min(2).max(120), email: z.string().email(), phone: z.string().max(30).optional(),
  message: z.string().max(3000).optional(), website: z.string().max(0).optional(), // honeypot: must stay empty
  gender: z.string().max(60).optional(), race: z.string().max(80).optional(), veteran: z.string().max(60).optional(), disability: z.string().max(60).optional(),
  smsConsent: z.enum(['on']).optional(),
});

// Simple per-instance rate limit. Replace with Upstash/Redis in production (see CLAUDE.md).
const hits = new Map<string, number[]>();
function limited(ip: string) { const now = Date.now(); const h = (hits.get(ip) ?? []).filter((t) => now - t < 3600e3); h.push(now); hits.set(ip, h); return h.length > 10; }

/** Public apply endpoint for the hosted careers pages and embed widget. */
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return Response.json({ error: 'Too many applications from this network. Try again later.' }, { status: 429 });
  const org = await db.organization.findUnique({ where: { slug: params.slug } });
  if (!org || !['trialing', 'active'].includes(org.subscriptionStatus)) return Response.json({ error: 'Not found' }, { status: 404 });

  const form = await req.formData();
  const parsed = Fields.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string')));
  if (!parsed.success) return Response.json({ error: 'Please enter your name and a valid email.' }, { status: 400 });
  const f = parsed.data; const tdb = tenantDb(org.id);
  const job = await tdb.job.findFirst({ where: { id: f.jobId, status: 'OPEN', publish: true } });
  if (!job) return Response.json({ error: 'This job is no longer open.' }, { status: 404 });

  const resume = form.get('resume');
  let resumeFileId: string | undefined;
  if (resume instanceof File && resume.size > 0) {
    try { resumeFileId = (await putFile(org.id, resume.name, resume.type, Buffer.from(await resume.arrayBuffer()))).id; }
    catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
  }
  const email = f.email.toLowerCase();
  let cand = await tdb.candidate.findFirst({ where: { email } });
  if (!cand) cand = await tdb.candidate.create({ data: { name: f.name, email, phone: f.phone, source: 'Careers page', summary: f.message, resumeFileId, smsOptOut: !f.smsConsent } as never });
  else await tdb.candidate.updateMany({ where: { id: cand.id }, data: { ...(resumeFileId ? { resumeFileId } : {}), ...(f.phone ? { phone: f.phone } : {}) } });

  const existing = await tdb.application.findFirst({ where: { candidateId: cand.id, jobId: job.id } });
  if (!existing) await tdb.application.create({ data: { candidateId: cand.id, jobId: job.id, stage: 'APPLIED', maxStage: 'APPLIED' } as never });

  if (f.gender || f.race || f.veteran || f.disability) {
    const prev = await tdb.eeoSelfId.findFirst({ where: { candidateId: cand.id } });
    const data = { gender: cleanEeoAnswer('gender', f.gender), race: cleanEeoAnswer('race', f.race), veteran: cleanEeoAnswer('veteran', f.veteran), disability: cleanEeoAnswer('disability', f.disability), collectedAt: new Date() };
    if (prev) await tdb.eeoSelfId.updateMany({ where: { id: prev.id }, data }); else await tdb.eeoSelfId.create({ data: { candidateId: cand.id, ...data } as never });
  }
  await db.activity.create({ data: { organizationId: org.id, text: `${f.name} applied to ${job.title} from the careers page` } });
  if (org.applyEmail) await sendEmail({ to: org.applyEmail, subject: `New applicant: ${f.name} for ${job.title}`, replyTo: email, text: `${f.name} (${email}${f.phone ? ', ' + f.phone : ''}) applied to ${job.title}.\n\nOpen Preciops to review: ${process.env.APP_URL}/app/candidates` }).catch((e) => console.error('[apply] notification email failed', e));
  await sendEmail({ to: email, fromName: org.shortName ?? org.name, replyTo: org.applyEmail ?? undefined, subject: `We received your application — ${job.title}`, text: `Hi ${f.name.split(' ')[0]},\n\nThanks for applying for ${job.title} with ${org.shortName ?? org.name}. A recruiter will review your background and reach out if it's a fit.\n\n${org.name}` }).catch((e) => console.error('[apply] confirmation email failed', e));
  return Response.json({ ok: true });
}
export function OPTIONS() { return new Response(null, { status: 204 }); }
