import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { RECORDS, OWNED_KINDS, isRecordKind, type RecordKind } from '@/lib/records';
import { delegate, parseRecord } from '@/lib/records-server';

function kindOf(k: string): RecordKind {
  if (!isRecordKind(k)) throw new HttpError(404, 'Not found');
  return k;
}

/** Options for "linked record" selects: [{ id, label }], sorted by name. */
export const GET = withApi(async (_req: Request, { params }: { params: { kind: string } }) => {
  const kind = kindOf(params.kind);
  const { tdb } = await requireApiContext({ feature: RECORDS[kind].feature });
  const key = RECORDS[kind].titleKey;
  const rows = await delegate(tdb, kind).findMany({ select: { id: true, [key]: true }, orderBy: { [key]: 'asc' }, take: 2000 });
  return Response.json(rows.map((r) => ({ id: r.id, label: r[key] })));
});

export const POST = withApi(async (req: Request, { params }: { params: { kind: string } }) => {
  const kind = kindOf(params.kind);
  const { tdb, org, user } = await requireApiContext({ minRole: kind === 'branches' ? 'ADMIN' : 'RECRUITER', feature: RECORDS[kind].feature, write: true });
  const body = await req.json().catch(() => ({}));
  const data = await parseRecord(tdb, kind, body, 'create', org.id);
  if (OWNED_KINDS.includes(kind) && data.ownerId === undefined) data.ownerId = user.id;
  if (kind === 'deals' && (data.stage === 'Won' || data.stage === 'Lost')) data.closedAt = new Date();
  if (kind === 'leads' && data.status === 'Converted') data.convertedAt = new Date();
  if (kind === 'contacts') {
    const client = typeof body.clientId === 'string' ? await tdb.client.findFirst({ where: { id: body.clientId }, select: { id: true } }) : null;
    if (!client) throw new HttpError(400, 'That client was not found.');
    data.clientId = client.id;
  }
  const row = await delegate(tdb, kind).create({ data });
  await logActivity(org.id, `Added ${RECORDS[kind].one} ${row[RECORDS[kind].titleKey]}`, user.id);
  return Response.json({ id: row.id }, { status: 201 });
});
