import { resolveWorkerLink } from '@/lib/schedule-server';
import { limited } from '@/lib/rate-limit';
import { HttpError, tenantDb } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { getFile } from '@/lib/storage';
import { removePhoto, savePhoto } from '@/lib/employee-hub';

type Ctx = { params: { token: string } };
const gone = () => Response.json({ error: 'This link has expired. Ask your manager to send it again.' }, { status: 404 });

/** The employee behind the link (current employees only). */
async function me(token: string) {
  const link = await resolveWorkerLink(token);
  if (!link || !hasFeature(link.organization, 'people')) return null;
  const tdb = tenantDb(link.organizationId);
  const e = await tdb.employee.findFirst({ where: { candidateId: link.candidateId, status: { not: 'TERMINATED' } }, select: { id: true } });
  if (!e) return null;
  const candidate = await tdb.candidate.findFirst({ where: { id: link.candidateId }, select: { id: true, name: true, photoFileId: true } });
  return candidate ? { link, tdb, candidate } : null;
}
const fail = (e: unknown) => { if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status }); throw e; };

/** Their own picture. */
export async function GET(_req: Request, { params }: Ctx) {
  const m = await me(params.token);
  if (!m) return gone();
  const f = m.candidate.photoFileId ? await m.tdb.storedFile.findFirst({ where: { id: m.candidate.photoFileId } }) : null;
  if (!f) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(await getFile(f.key)), { headers: { 'Content-Type': f.contentType, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
}

/** Upload a new picture: the image bytes as the request body (the page shrinks it to a small JPEG first). */
export async function POST(req: Request, { params }: Ctx) {
  if (await limited('photo', params.token.slice(0, 20), 10, 600e3)) return Response.json({ error: 'Too many uploads. Try again in a few minutes.' }, { status: 429 });
  const m = await me(params.token);
  if (!m) return gone();
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > 2 * 1024 * 1024) return Response.json({ error: 'That picture is too large. Choose one under 2 MB.' }, { status: 413 });
  try { return Response.json(await savePhoto(m.tdb, m.link.organizationId, m.candidate, Buffer.from(await req.arrayBuffer()))); } catch (e) { return fail(e); }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const m = await me(params.token);
  if (!m) return gone();
  return Response.json(await removePhoto(m.tdb, m.candidate));
}
