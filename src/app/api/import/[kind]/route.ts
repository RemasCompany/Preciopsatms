import { z } from 'zod';
import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { RECORDS } from '@/lib/records';
import { IMPORT_KINDS, importCsv } from '@/lib/import-export';
import { audit } from '@/lib/audit';

/** Import records from CSV text: { csv }. */
export const POST = withApi(async (req: Request, { params }: { params: { kind: string } }) => {
  const kind = IMPORT_KINDS.find((k) => k === params.kind);
  if (!kind) throw new HttpError(404, 'Not found');
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: RECORDS[kind].feature, write: true });
  const { csv } = z.object({ csv: z.string().max(5_000_000, 'That file is too large. Split it into smaller files.') }).parse(await req.json());
  const result = await importCsv(tdb, kind, csv, org.id, user.id);
  if (result.created) {
    await logActivity(org.id, `Imported ${result.created} ${kind}`, user.id);
    await audit(org.id, user, 'data.import', `Imported ${result.created} ${kind} from CSV`, { targetType: kind, req });
  }
  return Response.json(result);
});
