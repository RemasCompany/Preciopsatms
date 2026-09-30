import { hasFeature } from '@/lib/plans';
import { HttpError } from '@/lib/tenant';
import { resolveWorkerLink } from '@/lib/schedule-server';
import { PunchBody, punch } from '@/lib/timeclock-server';

// Simple per-instance rate limit. Replace with Upstash/Redis in production (see CLAUDE.md).
const hits = new Map<string, number[]>();
function limited(key: string) { const now = Date.now(); const h = (hits.get(key) ?? []).filter((t) => now - t < 600e3); h.push(now); hits.set(key, h); return h.length > 30; }

/** Clock in, start or end a break, or clock out, from the worker's private link. */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  if (limited(params.token.slice(0, 20))) return Response.json({ error: 'Too many taps. Wait a minute and try again.' }, { status: 429 });
  const link = await resolveWorkerLink(params.token);
  if (!link) return Response.json({ error: 'This link has expired. Ask your recruiter for a new time clock link.' }, { status: 404 });
  if (!hasFeature(link.organization, 'timeclock')) return Response.json({ error: 'The time clock isn’t turned on for this company.' }, { status: 402 });
  const b = PunchBody.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: 'Something went wrong. Try again.' }, { status: 400 });
  try { return Response.json(await punch(link, b.data)); }
  catch (e) { if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status }); console.error(e); return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 }); }
}
