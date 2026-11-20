import { HttpError } from '@/lib/tenant';
import { resolveWorkerLink } from '@/lib/schedule-server';
import { hasFeature } from '@/lib/plans';
import { limited } from '@/lib/rate-limit';
import { workerMedia } from '@/lib/training-media';

export const dynamic = 'force-dynamic';

/** A lesson's uploaded video (?t=video) or captions (?t=caption), only for the worker it was assigned to. */
export async function GET(req: Request, { params }: { params: { token: string } }) {
  if (await limited('training-media', params.token.slice(0, 20), 1500, 600e3)) return new Response('Too many requests', { status: 429 });
  const link = await resolveWorkerLink(params.token);
  if (!link || !hasFeature(link.organization, 'training')) return new Response('This link has expired.', { status: 404 });
  const u = new URL(req.url);
  const lesson = Number(u.searchParams.get('l'));
  const e = u.searchParams.get('e') ?? '';
  if (!e || e.length > 40 || !Number.isInteger(lesson) || lesson < 0) return new Response('Not found', { status: 404 });
  try {
    return await workerMedia(link, e, lesson, u.searchParams.get('t') === 'caption' ? 'caption' : 'video', req.headers.get('range'));
  } catch (err) {
    if (err instanceof HttpError) return new Response(err.message, { status: err.status });
    throw err;
  }
}
