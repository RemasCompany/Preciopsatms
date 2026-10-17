import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { DeductionBody, createDeduction, listDeductions } from '@/lib/deductions-server';

/** Recurring paycheck deductions (benefits, retirement, other after-tax). */
export const GET = withApi(async () => {
  const { tdb } = await requireApiContext({ minRole: 'ADMIN', feature: 'payrollRuns' });
  return Response.json({ deductions: await listDeductions(tdb) });
});

export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'payrollRuns', write: true });
  const p = DeductionBody.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? 'Invalid input');
  return Response.json({ ok: true, id: await createDeduction(tdb, org, user, p.data) }, { status: 201 });
});
