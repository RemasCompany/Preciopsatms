import { z } from 'zod';
import { requireApiContext, withApi, logActivity } from '@/lib/tenant';
import { parseWeek } from '@/lib/weeks';

const Body = z.object({ week: z.string(), action: z.enum(['approve', 'markPaid', 'reopen']), applicationIds: z.array(z.string()).optional() });

export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'timesheets', write: true });
  const b = Body.parse(await req.json());
  const week = parseWeek(b.week);
  const scope = { weekEnding: week, ...(b.applicationIds ? { applicationId: { in: b.applicationIds } } : {}) };
  const res =
    b.action === 'approve' ? await tdb.timesheet.updateMany({ where: { ...scope, status: 'DRAFT' }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: user.id } })
    : b.action === 'markPaid' ? await tdb.timesheet.updateMany({ where: { ...scope, status: 'APPROVED' }, data: { status: 'PAID', paidAt: new Date() } })
    : await tdb.timesheet.updateMany({ where: { ...scope, status: 'APPROVED' }, data: { status: 'DRAFT', approvedAt: null, approvedById: null } });
  await logActivity(org.id, `${b.action === 'approve' ? 'Approved' : b.action === 'markPaid' ? 'Marked paid' : 'Reopened'} ${res.count} timesheets for week ending ${b.week}`, user.id);
  return Response.json({ updated: res.count });
});
