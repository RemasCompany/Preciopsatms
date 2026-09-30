import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { RECORDS } from '@/lib/records';
import { toCsv } from '@/lib/csv';
import { EXPORT_KINDS, exportRows } from '@/lib/import-export';
import { audit } from '@/lib/audit';

/** Download every record of a kind as CSV. */
export const GET = withApi(async (req: Request, { params }: { params: { kind: string } }) => {
  const kind = EXPORT_KINDS.find((k) => k === params.kind);
  if (!kind) throw new HttpError(404, 'Not found');
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: RECORDS[kind].feature });
  const today = new Date().toISOString().slice(0, 10);
  const rows = await exportRows(tdb, kind, org.id);
  await audit(org.id, user, 'data.export', `Exported ${Math.max(rows.length - 1, 0)} ${kind} to CSV`, { targetType: kind, req });
  return new Response(toCsv(rows), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${kind}-${today}.csv"`, 'Cache-Control': 'private, no-store' },
  });
});
