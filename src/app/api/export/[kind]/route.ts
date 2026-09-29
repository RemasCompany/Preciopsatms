import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { RECORDS } from '@/lib/records';
import { toCsv } from '@/lib/csv';
import { EXPORT_KINDS, exportRows } from '@/lib/import-export';

/** Download every record of a kind as CSV. */
export const GET = withApi(async (_req: Request, { params }: { params: { kind: string } }) => {
  const kind = EXPORT_KINDS.find((k) => k === params.kind);
  if (!kind) throw new HttpError(404, 'Not found');
  const { tdb, org } = await requireApiContext({ minRole: 'RECRUITER', feature: RECORDS[kind].feature });
  const today = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(await exportRows(tdb, kind, org.id)), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${kind}-${today}.csv"`, 'Cache-Control': 'private, no-store' },
  });
});
