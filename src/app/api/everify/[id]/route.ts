import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { UpdateCase, updateCase } from '@/lib/everify-server';

/** Record the case number and status as the case moves along in E-Verify. */
export const PATCH = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'onboarding', write: true });
  const b = UpdateCase.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'Invalid input');
  await updateCase(tdb, org, user, params.id, b.data);
  return Response.json({ ok: true });
});
