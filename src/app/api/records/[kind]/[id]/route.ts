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
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: RECORDS[kind].feature, write: true });
  const before = await delegate(tdb, kind).findFirst({ where: { id: params.id } });
  if (!before) throw new HttpError(404, 'That record was deleted.');
  const body = await req.json().catch(() => ({}));
  // An unchanged owner who has since left the team mustn't block saving other edits.
  if (body && typeof body === 'object' && 'ownerId' in body && body.ownerId === before.ownerId) delete body.ownerId;
  const data = await parseRecord(tdb, kind, body, 'update', org.id);
  // Timestamps the sales metrics depend on: when a deal changed stage or closed, when a lead converted.
  if (kind === 'deals' && data.stage && data.stage !== before.stage) {
    data.stageChangedAt = new Date();
    data.closedAt = data.stage === 'Won' || data.stage === 'Lost' ? new Date() : null;
  }
  if (kind === 'leads' && data.status && data.status !== before.status) data.convertedAt = data.status === 'Converted' ? new Date() : null;
  await delegate(tdb, kind).updateMany({ where: { id: params.id }, data });

  // Side effects from the prototype: winning a deal activates its client; deal moves and finished tasks are logged.
  if (kind === 'deals' && data.stage && data.stage !== before.stage) {
    await logActivity(org.id, `Deal “${before.title}” moved to ${data.stage}`, user.id);
    const clientId = (data.clientId ?? before.clientId) as string | null;
    if (data.stage === 'Won' && clientId) await tdb.client.updateMany({ where: { id: clientId, status: { not: 'Active' } }, data: { status: 'Active' } });
  }
  if (kind === 'tasks' && data.done === true && !before.done) await logActivity(org.id, `Completed: ${before.title}`, user.id);
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
  if (kind === 'clients' && (await tdb.invoice.count({ where: { clientId: String(row.id) } }))) {
    throw new HttpError(409, 'This client has invoices, so it can’t be deleted (they’re financial records). Set its status to Inactive instead.');
  }
  if (kind === 'candidates') await tdb.eeoSelfId.deleteMany({ where: { candidateId: params.id } });
  await delegate(tdb, kind).deleteMany({ where: { id: row.id } });
  await logActivity(org.id, `Deleted ${RECORDS[kind].one} ${row[RECORDS[kind].titleKey]}`, user.id);
  return Response.json({ ok: true });
});
