import { z } from 'zod';
import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { recompute } from '@/lib/onboarding-server';

const Body = z.union([
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('startDate'), startDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid start date.'), z.null()]) }),
]);

/** Cancel an onboarding (drafted, unsigned documents are voided) or change its start date. */
export const PATCH = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'onboarding', write: true });
  const r = Body.safeParse(await req.json().catch(() => null));
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Invalid input');
  const ob = await tdb.onboarding.findFirst({ where: { id: params.id }, include: { steps: true, application: { select: { candidate: { select: { name: true } } } } } });
  if (!ob) throw new HttpError(404, 'That onboarding was deleted.');
  if (ob.status === 'CANCELLED') throw new HttpError(409, 'This onboarding was already cancelled.');
  if (r.data.action === 'startDate') {
    await tdb.onboarding.updateMany({ where: { id: ob.id }, data: { startDate: r.data.startDate ? new Date(`${r.data.startDate}T00:00:00Z`) : null } });
    return Response.json({ ok: true });
  }
  const docs = ob.steps.map((s) => s.signDocumentId).filter(Boolean) as string[];
  await tdb.$transaction(async (tx) => {
    await tx.onboarding.updateMany({ where: { id: ob.id }, data: { status: 'CANCELLED' } });
    if (docs.length) await tx.signDocument.updateMany({ where: { id: { in: docs }, status: { in: ['DRAFT', 'SENT'] } }, data: { status: 'VOID', tokenHash: null } });
  });
  await logActivity(org.id, `Cancelled onboarding for ${ob.application.candidate.name} (${ob.packageName})`, user.id);
  await recompute(tdb, ob.id);
  return Response.json({ ok: true });
});
