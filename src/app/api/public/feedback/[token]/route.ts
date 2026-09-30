import { HttpError } from '@/lib/tenant';
import { limited } from '@/lib/rate-limit';
import { resolveFeedbackLink, submitClientFeedback } from '@/lib/engagement-server';

const gone = () => Response.json({ error: 'This feedback link has expired or was already used. Thank you!' }, { status: 404 });

/** A client contact's one-time feedback page: who it's about. */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const f = await resolveFeedbackLink(params.token);
  if (!f) return gone();
  return Response.json({ company: f.r.organization.shortName ?? f.r.organization.name, brandColor: f.r.organization.brandColor, worker: f.app.candidate.name, job: f.app.job.title, client: f.app.job.client?.name ?? null, contact: f.contact.name });
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  if (await limited('client-feedback', params.token.slice(0, 20), 10)) return Response.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  try { return Response.json(await submitClientFeedback(params.token, await req.json().catch(() => null))); }
  catch (e) { if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status }); console.error(e); return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 }); }
}
