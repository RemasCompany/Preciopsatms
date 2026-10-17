import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { applyDeductions } from '@/lib/deductions-server';

export const DELETE = withApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const { tdb } = await requireApiContext({ minRole: 'ADMIN', feature: 'payrollRuns', write: true });
  const a = await tdb.payrollAdjustment.findFirst({ where: { id: params.id }, include: { item: { include: { run: { select: { id: true, status: true, payDate: true } } } } } });
  if (!a) throw new HttpError(404, 'That adjustment was removed.');
  if (a.item.run.status !== 'DRAFT') throw new HttpError(409, 'Only draft runs can change. Reopen the run first.');
  if (a.deductionId) throw new HttpError(409, 'This comes from a recurring deduction. End or change it under Payroll → Recurring deductions.');
  await tdb.payrollAdjustment.deleteMany({ where: { id: a.id } });
  // Percent-of-pay deductions follow the worker's gross.
  await tdb.$transaction((tx) => applyDeductions(tx, a.item.run));
  return Response.json({ ok: true });
});
