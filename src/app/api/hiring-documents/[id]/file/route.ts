import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { openDocFile } from '@/lib/hiring-docs-server';

/** Open one file (?f=fileId). Tax, bank and identity documents: owners and admins only, and audited. */
export const GET = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireApiContext({});
  const f = new URL(req.url).searchParams.get('f');
  if (!f) throw new HttpError(400, 'Choose a file.');
  const file = await openDocFile(ctx, params.id, f, req);
  const name = file.name.replace(/[^\w .()-]/g, '_');
  return new Response(new Uint8Array(file.body), { headers: { 'Content-Type': file.type, 'Content-Disposition': `inline; filename="${name}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" } });
});
