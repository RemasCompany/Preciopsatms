import { requireApiContext, withApi } from '@/lib/tenant';
import { RuleBody, listRules, saveRule } from '@/lib/differentials-server';

export const GET = withApi(async () => {
  const { tdb } = await requireApiContext({ feature: 'timesheets' });
  return Response.json({ rules: await listRules(tdb) });
});

/** Add a pay differential (night, weekend, holiday, on-call…). Admins only: it changes pay and bills. */
export const POST = withApi(async (req: Request) => {
  const ctx = await requireApiContext({ minRole: 'ADMIN', feature: 'timesheets', write: true });
  const b = RuleBody.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: b.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  return Response.json({ id: await saveRule(ctx, b.data) }, { status: 201 });
});
