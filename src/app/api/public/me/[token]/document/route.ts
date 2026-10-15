import { resolveWorkerLink } from '@/lib/schedule-server';
import { tenantDb } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { getFile } from '@/lib/storage';
import { limited } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** A signed copy of one of the employee's own documents. */
export async function GET(req: Request, { params }: { params: { token: string } }) {
  if (await limited('me-doc', params.token.slice(0, 20), 30, 600e3)) return Response.json({ error: 'Too many requests. Try again in a few minutes.' }, { status: 429 });
  const link = await resolveWorkerLink(params.token);
  if (!link || !hasFeature(link.organization, 'people') || !hasFeature(link.organization, 'esign')) return Response.json({ error: 'This link has expired.' }, { status: 404 });
  const tdb = tenantDb(link.organizationId);
  const id = new URL(req.url).searchParams.get('id') ?? '';
  const doc = await tdb.signDocument.findFirst({ where: { id, relatedType: 'candidate', relatedId: link.candidateId }, select: { title: true, pdfFileId: true } });
  const file = doc?.pdfFileId ? await tdb.storedFile.findFirst({ where: { id: doc.pdfFileId } }) : null;
  if (!doc || !file || !(await tdb.employee.findFirst({ where: { candidateId: link.candidateId } }))) return Response.json({ error: 'That document isn’t available.' }, { status: 404 });
  const name = `${doc.title.replace(/[^\w .()-]/g, ' ').replace(/\s+/g, ' ').trim() || 'document'}.pdf`;
  return new Response(new Uint8Array(await getFile(file.key)), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' } });
}
