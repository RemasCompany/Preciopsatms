import { z } from 'zod';
import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { Rating, parse } from '@/lib/engagement-server';

const Body = z.object({ candidateId: z.string().min(1), applicationId: z.string().optional().nullable(), rating: Rating, wouldRehire: z.boolean().optional().nullable(), comment: z.string().trim().max(1000).optional(), from: z.string().trim().max(100).optional() });

/** Staff log feedback they heard (e.g. a supervisor's call). */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'engagement', write: true });
  const b = parse(Body, await req.json().catch(() => null));
  const c = await tdb.candidate.findFirst({ where: { id: b.candidateId } });
  if (!c) throw new HttpError(404, 'That person was deleted.');
  if (b.applicationId && !(await tdb.application.findFirst({ where: { id: b.applicationId, candidateId: c.id } }))) throw new HttpError(404, 'That assignment wasn’t found.');
  const f = await tdb.feedback.create({ data: { candidateId: c.id, applicationId: b.applicationId ?? null, source: 'STAFF', rating: b.rating, wouldRehire: b.wouldRehire ?? null, comment: b.comment || null, authorName: b.from || null, createdById: user.id } as never });
  await logActivity(org.id, `Logged ${b.rating}/5 feedback for ${c.name}${b.from ? ` from ${b.from}` : ''}`, user.id);
  return Response.json({ id: f.id }, { status: 201 });
});
