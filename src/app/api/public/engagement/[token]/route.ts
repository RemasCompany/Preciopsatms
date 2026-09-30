import { hasFeature } from '@/lib/plans';
import { HttpError } from '@/lib/tenant';
import { limited } from '@/lib/rate-limit';
import { resolveWorkerLink } from '@/lib/schedule-server';
import { workerAct } from '@/lib/engagement-server';

/** From the worker's private page: rate how the assignment is going, or share their birthday. */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  if (await limited('engagement', params.token.slice(0, 20), 20)) return Response.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  const link = await resolveWorkerLink(params.token);
  if (!link) return Response.json({ error: 'This link has expired. Ask your recruiter for a new one.' }, { status: 404 });
  if (!hasFeature(link.organization, 'engagement')) return Response.json({ error: 'This isn’t turned on for this company.' }, { status: 402 });
  try { return Response.json(await workerAct(link, await req.json().catch(() => null))); }
  catch (e) { if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status }); console.error(e); return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 }); }
}
