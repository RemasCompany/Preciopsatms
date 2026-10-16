import { HttpError } from '@/lib/tenant';
import { resolveWorkerLink } from '@/lib/schedule-server';
import { candidateIcs } from '@/lib/interviews-server';

/** "Add to calendar" for a booked interview (?id=). */
export async function GET(req: Request, { params }: { params: { token: string } }) {
  const link = await resolveWorkerLink(params.token);
  if (!link) return new Response('This link has expired.', { status: 404 });
  try {
    const body = await candidateIcs(link, new URL(req.url).searchParams.get('id') ?? '');
    return new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="interview.ics"', 'Cache-Control': 'private, no-store' } });
  } catch (e) { if (e instanceof HttpError) return new Response(e.message, { status: e.status }); throw e; }
}
