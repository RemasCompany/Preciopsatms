import { requireApiContext, withApi } from '@/lib/tenant';
import { toCsv } from '@/lib/csv';
import { actionLabel, audit, auditWhere, describeChanges } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** The audit log as CSV (up to 50,000 rows, newest first), with the same filters as the screen. Owners and admins. */
export const GET = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN' });
  const q = Object.fromEntries(new URL(req.url).searchParams);
  const rows = await tdb.auditLog.findMany({ where: auditWhere(q), orderBy: { createdAt: 'desc' }, take: 50_000 });
  await audit(org.id, user, 'data.audit_export', `Exported ${rows.length} audit log entries`, { req });
  const csv = toCsv([
    ['When (UTC)', 'Who', 'Action', 'What happened', 'Changes', 'Target type', 'Target ID', 'IP address', 'Browser'],
    ...rows.map((r) => [r.createdAt.toISOString(), r.actorEmail ?? 'System', actionLabel(r.action), r.summary, describeChanges(r.changes), r.targetType ?? '', r.targetId ?? '', r.ip ?? '', r.userAgent ?? '']),
  ]);
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'private, no-store' } });
});
