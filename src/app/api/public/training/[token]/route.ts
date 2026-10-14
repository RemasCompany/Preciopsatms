import { z } from 'zod';
import { HttpError } from '@/lib/tenant';
import { resolveWorkerLink } from '@/lib/schedule-server';
import { hasFeature } from '@/lib/plans';
import { limited } from '@/lib/rate-limit';
import { markLesson, submitQuiz } from '@/lib/training-server';

const Body = z.object({ enrollmentId: z.string().min(1), lesson: z.number().int().optional(), answers: z.array(z.number().int().nullable()).optional() });

/** A worker marks a lesson read or submits the quiz from their private link. */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  if (await limited('training', params.token.slice(0, 20), 120, 600e3)) return Response.json({ error: 'Too many requests. Try again in a few minutes.' }, { status: 429 });
  const link = await resolveWorkerLink(params.token);
  if (!link || !hasFeature(link.organization, 'training')) return Response.json({ error: 'This link has expired. Ask your recruiter for a new one.' }, { status: 404 });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: 'Invalid input' }, { status: 400 });
  try {
    if (b.data.answers) return Response.json(await submitQuiz(link, b.data.enrollmentId, { answers: b.data.answers }));
    if (b.data.lesson !== undefined) return Response.json(await markLesson(link, b.data.enrollmentId, b.data.lesson));
    return Response.json({ error: 'Invalid input' }, { status: 400 });
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
    if (e && typeof e === 'object' && 'issues' in e) return Response.json({ error: 'Answer every question.' }, { status: 400 });
    throw e;
  }
}
