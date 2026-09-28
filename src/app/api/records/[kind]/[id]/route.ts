import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { RECORDS, isRecordKind, type RecordKind } from '@/lib/records';
import { delegate, loadExtras, parseRecord, toValues } from '@/lib/records-server';

type Ctx = { params: { kind: string; id: string } };
function kindOf(k: string): RecordKind {
  if (!isRecordKind(k)) throw new HttpError(404, 'Not found');
  return k;
}

export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const kind = kindOf(params.kind);
  const { tdb } = await requireApiContext({ feature: RECORDS[kind].feature });
  const row = await delegate(tdb, kind).findFirst({ where: { id: params.id } });
  if (!row) throw new HttpError(404, 'That record was deleted.');
  return Response.json({ record: toValues(kind, row), extras: await loadExtras(tdb, kind, params.id) });
});

export const PATCH = withApi(async (req: Request, { params }: Ctx) => {
  const kind = kindOf(params.kind);
  const { tdb } = await requireApiContext({ minRole: 'RECRUITER', feature: RECORDS[kind].feature, write: true });
  const data = await parseRecord(tdb, kind, await req.json().catch(() => ({})), 'update');
  const { count } = await delegate(tdb, kind).updateMany({ where: { id: params.id }, data });
  if (!count) throw new HttpError(404, 'That record was deleted.');
  return Response.json({ ok: true });
});

export const DELETE = withApi(async (_req: Request, { params }: Ctx) => {
  const kind = kindOf(params.kind);
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: RECORDS[kind].feature, write: true });
  const row = await delegate(tdb, kind).findFirst({ where: { id: params.id } });
  if (!row) throw new HttpError(404, 'That record was deleted.');
  if (kind === 'jobs' || kind === 'candidates') {
    // Deleting cascades to applications and their timesheets; never destroy payroll history.
    const locked = await tdb.timesheet.count({ where: { status: { in: ['APPROVED', 'PAID'] }, application: { [kind === 'jobs' ? 'jobId' : 'candidateId']: row.id } } });
    if (locked) throw new HttpError(409, `This ${RECORDS[kind].one} has approved timesheets, so it can’t be deleted. ${kind === 'jobs' ? 'Close the job' : 'Mark the candidate inactive'} instead.`);
  }
  if (kind === 'candidates') await tdb.eeoSelfId.deleteMany({ where: { candidateId: params.id } });
  await delegate(tdb, kind).deleteMany({ where: { id: row.id } });
  await logActivity(org.id, `Deleted ${RECORDS[kind].one} ${row[RECORDS[kind].titleKey]}`, user.id);
  return Response.json({ ok: true });
});
