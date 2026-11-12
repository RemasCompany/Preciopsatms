import { HttpError } from '@/lib/tenant';
import { resolveWorkerLink } from '@/lib/schedule-server';
import { hasFeature } from '@/lib/plans';
import { limited } from '@/lib/rate-limit';
import { SubmitBody, submitChecklist } from '@/lib/checklists-server';

/** A worker submits a skills checklist from their private link. */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  if (await limited('checklists', params.token.slice(0, 20), 30, 600e3)) return Response.json({ error: 'Too many requests. Try again in a few minutes.' }, { status: 429 });
  const link = await resolveWorkerLink(params.token);
  if (!link || !hasFeature(link.organization, 'credentials')) return Response.json({ error: 'This link has expired. Ask your recruiter for a new one.' }, { status: 404 });
  const b = SubmitBody.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: b.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  try { return Response.json(await submitChecklist(link, b.data)); }
  catch (e) { if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
}
