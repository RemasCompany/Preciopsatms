import { z } from 'zod';
import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { parseWeek } from '@/lib/weeks';

const Body = z.object({ week: z.string(), action: z.enum(['approve', 'markPaid', 'reopen']), applicationIds: z.array(z.string()).optional() });

export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'timesheets', write: true });
  const b = Body.parse(await req.json());
  const week = parseWeek(b.week);
  const scope = { weekEnding: week, ...(b.applicationIds ? { applicationId: { in: b.applicationIds } } : {}) };
  if (b.action === 'reopen') {
    // Hours already in an approved or paid payroll run are locked; reopening drops them from a draft run.
    const inRuns = await tdb.timesheet.findMany({ where: { ...scope, status: 'APPROVED', payrollRunId: { not: null } }, select: { id: true, payrollRunId: true } });
    const runs = inRuns.length ? await tdb.payrollRun.findMany({ where: { id: { in: [...new Set(inRuns.map((t) => t.payrollRunId!))] } } }) : [];
    const locked = runs.filter((r) => r.status !== 'DRAFT');
    if (locked.length) throw new HttpError(409, `These hours are in payroll run ${locked.map((r) => r.number).join(', ')}. Reopen or void the run first.`);
    if (inRuns.length) {
      await tdb.payrollItem.deleteMany({ where: { timesheetId: { in: inRuns.map((t) => t.id) } } });
      await tdb.timesheet.updateMany({ where: { id: { in: inRuns.map((t) => t.id) } }, data: { payrollRunId: null } });
    }
  }
  const res =
    b.action === 'approve' ? await tdb.timesheet.updateMany({ where: { ...scope, status: 'DRAFT' }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: user.id } })
    : b.action === 'markPaid' ? await tdb.timesheet.updateMany({ where: { ...scope, status: 'APPROVED', payrollRunId: null }, data: { status: 'PAID', paidAt: new Date() } })
    : await tdb.timesheet.updateMany({ where: { ...scope, status: 'APPROVED' }, data: { status: 'DRAFT', approvedAt: null, approvedById: null } });
  await logActivity(org.id, `${b.action === 'approve' ? 'Approved' : b.action === 'markPaid' ? 'Marked paid' : 'Reopened'} ${res.count} timesheets for week ending ${b.week}`, user.id);
  return Response.json({ updated: res.count });
});
