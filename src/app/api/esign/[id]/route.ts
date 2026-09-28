import { z } from 'zod';
import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { publicDoc, type AuditEntry } from '@/lib/esign';

type Ctx = { params: { id: string } };

export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb } = await requireApiContext({ feature: 'esign' });
  const doc = await tdb.signDocument.findFirst({ where: { id: params.id } });
  if (!doc) throw new HttpError(404, 'That document was deleted.');
  return Response.json({ document: publicDoc(doc) });
});

const Edit = z.object({
  title: z.string().trim().min(1, 'Give the document a title.').max(200).optional(),
  body: z.string().max(50000).optional(),
  signerName: z.string().trim().min(2, 'Enter the signer’s name.').max(120).optional(),
  signerEmail: z.string().trim().email('Enter a valid email address for the signer.').optional(),
});
const Body = z.union([z.object({ action: z.literal('void') }), Edit]);

/** Edit a draft, or void a draft or unsigned sent document (its signing link stops working). */
export const PATCH = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'esign', write: true });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
  const doc = await tdb.signDocument.findFirst({ where: { id: params.id } });
  if (!doc) throw new HttpError(404, 'That document was deleted.');
  const audit = (doc.audit as AuditEntry[]) ?? [];
  const at = new Date().toISOString();

  if ('action' in parsed.data) {
    if (!['DRAFT', 'SENT'].includes(doc.status)) throw new HttpError(409, 'A signed document can’t be voided.');
    await tdb.signDocument.updateMany({ where: { id: doc.id }, data: { status: 'VOID', tokenHash: null, tokenExpiresAt: null, audit: [...audit, { at, event: 'voided', by: user.email }] } });
    await logActivity(org.id, `Voided ${doc.title}`, user.id);
    return Response.json({ ok: true });
  }
  if (doc.status !== 'DRAFT') throw new HttpError(409, 'Only drafts can be edited. Void this document and create a new one to change it.');
  await tdb.signDocument.updateMany({ where: { id: doc.id }, data: { ...parsed.data, audit: [...audit, { at, event: 'edited', by: user.email }] } });
  return Response.json({ ok: true });
});
