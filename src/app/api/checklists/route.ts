import { requireApiContext, withApi } from '@/lib/tenant';
import { SendBody, candidateChecklists, sendChecklist } from '@/lib/checklists-server';

/** A candidate's skills checklists. */
export const GET = withApi(async (req: Request) => {
  const { tdb } = await requireApiContext({ feature: 'credentials' });
  const id = new URL(req.url).searchParams.get('candidateId') ?? '';
  return Response.json({ checklists: id ? await candidateChecklists(tdb, id) : [] });
});

/** Send a skills checklist to a worker's private link. */
export const POST = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'credentials', write: true });
  const b = SendBody.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: b.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  return Response.json(await sendChecklist(org, user, b.data), { status: 201 });
});
