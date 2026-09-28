import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { getFile } from '@/lib/storage';

/** Download the signed PDF (with audit trail) after checking it belongs to the caller's org. */
export const GET = withApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const { tdb } = await requireApiContext({ feature: 'esign' });
  const doc = await tdb.signDocument.findFirst({ where: { id: params.id }, select: { title: true, pdfFileId: true } });
  if (!doc) throw new HttpError(404, 'That document was deleted.');
  const file = doc.pdfFileId ? await tdb.storedFile.findFirst({ where: { id: doc.pdfFileId } }) : null;
  if (!file) throw new HttpError(404, 'There’s no signed PDF for this document yet.');
  const bytes = await getFile(file.key);
  const name = `${doc.title.replace(/[^\w .()-]/g, ' ').replace(/\s+/g, ' ').trim() || 'document'}.pdf`;
  return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' } });
});
