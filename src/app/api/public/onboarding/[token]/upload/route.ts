import { hasFeature } from '@/lib/plans';
import { HttpError } from '@/lib/tenant';
import { resolveWorkerLink } from '@/lib/schedule-server';
import { saveUpload } from '@/lib/onboarding-server';
import { limited } from '@/lib/rate-limit';

/** The new hire uploads a file for a step (multipart: stepId, file). */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  if (await limited('onboarding', params.token.slice(0, 20), 40)) return Response.json({ error: 'Too many requests. Wait a minute and try again.' }, { status: 429 });
  const link = await resolveWorkerLink(params.token);
  if (!link) return Response.json({ error: 'This link has expired. Ask your recruiter for a new onboarding link.' }, { status: 404 });
  if (!hasFeature(link.organization, 'onboarding')) return Response.json({ error: 'Onboarding isn’t turned on for this company.' }, { status: 402 });
  const form = await req.formData().catch(() => null);
  const stepId = form?.get('stepId'), file = form?.get('file');
  if (typeof stepId !== 'string' || !(file instanceof File)) return Response.json({ error: 'Choose a file.' }, { status: 400 });
  try { await saveUpload(link, stepId, file); return Response.json({ ok: true }); }
  catch (e) { if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status }); console.error(e); return Response.json({ error: 'The upload failed. Try again.' }, { status: 500 }); }
}
