import { HttpError } from '@/lib/tenant';
import { resolveWorkerLink } from '@/lib/schedule-server';
import { candidateRespond } from '@/lib/interviews-server';
import { limited } from '@/lib/rate-limit';

/** The candidate picks an offered time: { action: 'pick', interviewId, at } or { action: 'none', interviewId, note? }. */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  if (await limited('interview', params.token.slice(0, 20), 30, 600e3)) return Response.json({ error: 'Too many requests. Try again in a few minutes.' }, { status: 429 });
  const link = await resolveWorkerLink(params.token);
  if (!link) return Response.json({ error: 'This link has expired. Ask your recruiter for new times.' }, { status: 404 });
  try { return Response.json(await candidateRespond(link, await req.json().catch(() => null))); }
  catch (e) { if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
}
