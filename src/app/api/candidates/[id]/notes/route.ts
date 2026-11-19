import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { addNote, deleteNote, listNotes } from '@/lib/hiring-manager';

type Ctx = { params: { id: string } };

/** Internal notes on a candidate (never shown to them). */
export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb, user, role } = await requireApiContext({ feature: 'ats' });
  return Response.json({ notes: await listNotes(tdb, params.id, user, role) });
});

/** Add a note: recruiters and up, or a job's hiring manager on that job's application. */
export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const ctx = await requireApiContext({ feature: 'ats', write: true });
  return Response.json(await addNote(ctx, params.id, await req.json().catch(() => null)), { status: 201 });
});

/** ?note=<id>: the author or an admin. */
export const DELETE = withApi(async (req: Request, { params }: Ctx) => {
  const ctx = await requireApiContext({ feature: 'ats', write: true });
  const id = new URL(req.url).searchParams.get('note');
  if (!id) throw new HttpError(400, 'Which note?');
  return Response.json(await deleteNote(ctx, params.id, id));
});
