import { apiRoute, page, paged } from '@/lib/api-keys';
import { since } from '@/lib/api-v1';
import { HttpError } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

/** GET /api/v1/timesheets?weekEnding=2026-11-08&status=APPROVED&updatedSince=…&limit=&cursor= (rates as decimal strings). */
export const GET = apiRoute(async (req, { tdb }) => {
  const { limit, after, args, u } = page(req);
  const week = u.searchParams.get('weekEnding');
  if (week && !/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new HttpError(400, 'weekEnding must look like 2026-11-08.');
  const status = u.searchParams.get('status')?.toUpperCase();
  const rows = await tdb.timesheet.findMany({ ...args, where: { ...after, ...since(u), ...(week ? { weekEnding: new Date(`${week}T00:00:00Z`) } : {}), ...(status ? { status: status as never } : {}) },
    include: { application: { select: { candidateId: true, jobId: true } }, premiums: true } });
  const { data, nextCursor } = paged(rows, limit);
  return Response.json({ data: data.map((t) => ({ id: t.id, applicationId: t.applicationId, candidateId: t.application.candidateId, jobId: t.application.jobId, weekEnding: t.weekEnding.toISOString().slice(0, 10),
    regularHours: String(t.regularHours), overtimeHours: String(t.overtimeHours), leaveHours: String(t.leaveHours), payRate: String(t.payRate), billRate: String(t.billRate), status: t.status,
    premiums: t.premiums.map((p) => ({ label: p.label, kind: p.kind, hours: String(p.hours), payPerHour: String(p.payPerHour), billPerHour: String(p.billPerHour) })), approvedAt: t.approvedAt?.toISOString() ?? null, updatedAt: t.updatedAt.toISOString() })), nextCursor });
});
