import { z } from 'zod';
import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { checksFor, loadRun, syncItems } from '@/lib/payroll-run-server';
import { totals } from '@/lib/payroll-run';

type Ctx = { params: { id: string } };
const Body = z.object({ action: z.enum(['refresh', 'approve', 'unapprove', 'pay', 'void']), acknowledge: z.boolean().optional(), payDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb } = await requireApiContext({ minRole: 'ADMIN', feature: 'payrollRuns' });
  const loaded = await loadRun(tdb, params.id);
  return Response.json({ run: { ...loaded.meta, id: loaded.run.id, status: loaded.run.status }, items: loaded.items, totals: totals(loaded.items), checks: await checksFor(tdb, loaded) });
});

/**
 * Move a run through its life: refresh (draft) → approve (locks it; exports open) → pay (after the provider ran it).
 * An approved run can go back to draft; draft and approved runs can be voided, which releases their timesheets.
 */
export const PATCH = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'payrollRuns', write: true });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, 'Invalid input');
  const b = p.data;
  const run = await tdb.payrollRun.findFirst({ where: { id: params.id } });
  if (!run) throw new HttpError(404, 'That payroll run was deleted.');
  const DONE = { refresh: 'refreshed', approve: 'approved', unapprove: 'reopened', pay: 'marked paid', void: 'voided' } as const;
  const need = (...s: string[]) => { if (!s.includes(run.status)) throw new HttpError(409, `This run is ${run.status.toLowerCase()}, so it can’t be ${DONE[b.action]}.`); };

  if (b.action === 'refresh') {
    need('DRAFT');
    const r = await tdb.$transaction((tx) => syncItems(tx, run));
    return Response.json({ ok: true, ...r });
  }
  if (b.action === 'approve') {
    need('DRAFT');
    // Pull in anything approved since the last refresh, then check.
    await tdb.$transaction((tx) => syncItems(tx, run));
    const loaded = await loadRun(tdb, run.id);
    if (!loaded.items.length) throw new HttpError(400, 'There are no approved hours in this pay period yet.');
    const warnings = (await checksFor(tdb, loaded)).filter((c) => c.level === 'warn');
    if (warnings.length && !b.acknowledge) return Response.json({ ok: false, needsAcknowledge: true, warnings }, { status: 409 });
    await tdb.payrollRun.updateMany({ where: { id: run.id, status: 'DRAFT' }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: user.id } });
    const t = totals(loaded.items);
    await logActivity(org.id, `Approved payroll run ${run.number}: ${loaded.items.length} timesheets, $${(t.gross / 100).toFixed(2)} gross${warnings.length ? ` (approved with ${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : ''}`, user.id);
    return Response.json({ ok: true });
  }
  if (b.action === 'unapprove') {
    need('APPROVED');
    await tdb.payrollRun.updateMany({ where: { id: run.id, status: 'APPROVED' }, data: { status: 'DRAFT', approvedAt: null, approvedById: null } });
    await logActivity(org.id, `Reopened payroll run ${run.number} for changes`, user.id);
    return Response.json({ ok: true });
  }
  if (b.action === 'pay') {
    need('APPROVED');
    const now = new Date();
    await tdb.$transaction(async (tx) => {
      await tx.payrollRun.updateMany({ where: { id: run.id, status: 'APPROVED' }, data: { status: 'PAID', paidAt: now } });
      await tx.timesheet.updateMany({ where: { payrollRunId: run.id, status: 'APPROVED' }, data: { status: 'PAID', paidAt: now } });
    });
    await logActivity(org.id, `Marked payroll run ${run.number} as paid`, user.id);
    return Response.json({ ok: true });
  }
  need('DRAFT', 'APPROVED');
  await tdb.$transaction(async (tx) => {
    await tx.payrollRun.updateMany({ where: { id: run.id }, data: { status: 'VOID', voidedAt: new Date() } });
    await tx.timesheet.updateMany({ where: { payrollRunId: run.id }, data: { payrollRunId: null } });
  });
  await logActivity(org.id, `Voided payroll run ${run.number}; its timesheets can go in a new run`, user.id);
  return Response.json({ ok: true });
});
