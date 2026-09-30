import { z } from 'zod';
import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { ADJUSTMENTS } from '@/lib/payroll-run';

const Body = z.object({
  itemId: z.string().min(1, 'Choose a worker.'),
  kind: z.enum(Object.keys(ADJUSTMENTS) as [keyof typeof ADJUSTMENTS], { errorMap: () => ({ message: 'Choose a type.' }) }),
  description: z.string().trim().min(1, 'Describe it, e.g. “Referral bonus”.').max(120, 'Keep the description under 120 characters.'),
  amount: z.coerce.number({ invalid_type_error: 'Enter an amount.' }).positive('Enter an amount above $0.').max(100000, 'That amount is too large for one adjustment.')
    .refine((n) => Math.round(n * 100) === n * 100 || Math.abs(Math.round(n * 100) - n * 100) < 1e-6, 'Use dollars and cents, like 125.50.'),
});

/** Add a bonus, other earning, reimbursement or deduction to one worker's line in a draft run. */
export const POST = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'payrollRuns', write: true });
  const r = Body.safeParse(await req.json().catch(() => null));
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Invalid input');
  const run = await tdb.payrollRun.findFirst({ where: { id: params.id } });
  if (!run) throw new HttpError(404, 'That payroll run was deleted.');
  if (run.status !== 'DRAFT') throw new HttpError(409, 'Only draft runs can change. Reopen the run first.');
  const item = await tdb.payrollItem.findFirst({ where: { id: r.data.itemId, runId: run.id } });
  if (!item) throw new HttpError(404, 'That worker isn’t in this run.');
  const a = await tdb.payrollAdjustment.create({ data: { itemId: item.id, kind: r.data.kind, description: r.data.description, amount: r.data.amount.toFixed(2), createdById: user.id } as never });
  await logActivity(org.id, `Added a ${ADJUSTMENTS[r.data.kind].label.toLowerCase()} of $${r.data.amount.toFixed(2)} for ${item.workerName} to ${run.number}`, user.id);
  return Response.json({ id: a.id }, { status: 201 });
});
