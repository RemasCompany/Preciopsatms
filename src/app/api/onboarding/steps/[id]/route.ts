import { z } from 'zod';
import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { recompute } from '@/lib/onboarding-server';

const Body = z.object({ action: z.enum(['done', 'waive', 'reopen']), note: z.string().trim().max(300, 'Keep the note under 300 characters.').optional() });

/**
 * Staff complete their own tasks (I-9, payroll setup, background check…), or mark a worker step done or
 * waived with a note (e.g. a paper copy was signed). Signed documents can't be reopened.
 */
export const PATCH = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'onboarding', write: true });
  const r = Body.safeParse(await req.json().catch(() => null));
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Invalid input');
  const s = await tdb.onboardingStep.findFirst({ where: { id: params.id }, include: { onboarding: { include: { application: { select: { candidate: { select: { name: true } } } } } } } });
  if (!s) throw new HttpError(404, 'That step was removed.');
  if (s.onboarding.status === 'CANCELLED') throw new HttpError(409, 'This onboarding was cancelled.');
  const { action, note } = r.data;
  if (s.kind === 'CREDENTIAL' && action === 'done') throw new HttpError(400, 'This step completes itself once the credential is verified on the candidate’s record. Waive it instead if it doesn’t apply.');
  if ((action === 'waive' || (action === 'done' && s.kind !== 'STAFF')) && !note) throw new HttpError(400, action === 'waive' ? 'Say why this step doesn’t apply.' : 'Add a note, e.g. “Signed a paper copy on site”.');
  if (action === 'reopen') {
    if (s.kind === 'SIGN' && s.status === 'DONE' && s.completedBy === 'worker') throw new HttpError(409, 'This document is already signed. Void it in E-signatures and add a new one if it needs to change.');
    await tdb.onboardingStep.updateMany({ where: { id: s.id }, data: { status: 'PENDING', completedAt: null, completedBy: null, note: note || null } });
  } else {
    await tdb.onboardingStep.updateMany({ where: { id: s.id }, data: { status: action === 'done' ? 'DONE' : 'WAIVED', completedAt: new Date(), completedBy: user.id, note: note || null } });
  }
  await logActivity(org.id, `${action === 'done' ? 'Completed' : action === 'waive' ? 'Waived' : 'Reopened'} “${s.label}” for ${s.onboarding.application.candidate.name}${note ? `: ${note}` : ''}`, user.id);
  const p = await recompute(tdb, s.onboardingId);
  return Response.json({ ok: true, ready: p?.ready ?? false });
});
