import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { getFile } from '@/lib/storage';

/** Download a new hire's upload after checking it belongs to this company. */
export const GET = withApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const { tdb } = await requireApiContext({ minRole: 'RECRUITER', feature: 'onboarding' });
  const s = await tdb.onboardingStep.findFirst({ where: { id: params.id }, select: { fileId: true } });
  const file = s?.fileId ? await tdb.storedFile.findFirst({ where: { id: s.fileId } }) : null;
  if (!file) throw new HttpError(404, 'No file on this step.');
  const name = file.filename.replace(/[^\w .()-]/g, '_');
  return new Response(new Uint8Array(await getFile(file.key)), { headers: { 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
});
