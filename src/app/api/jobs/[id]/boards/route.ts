import { z } from 'zod';
import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { BOARDS, isBoard } from '@/lib/boards';

const Body = z.object({ boards: z.array(z.string()).max(40) });

/** Which boards this job goes to. An empty list posts it to every board that's turned on. */
export const PUT = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'ats', write: true });
  const r = Body.safeParse(await req.json().catch(() => null));
  if (!r.success) throw new HttpError(400, 'Choose the job boards.');
  const bad = r.data.boards.find((b) => !isBoard(b) || !org.jobBoards.includes(b));
  if (bad) throw new HttpError(409, isBoard(bad) ? `${BOARDS[bad]} isn’t turned on. Turn it on in Settings & data first.` : 'That job board isn’t supported.');
  const job = await tdb.job.findFirst({ where: { id: params.id }, select: { id: true, title: true } });
  if (!job) throw new HttpError(404, 'That job was deleted.');
  const boards = [...new Set(r.data.boards)];
  await tdb.job.updateMany({ where: { id: job.id }, data: { boards } });
  await logActivity(org.id, `${job.title}: posting to ${boards.length ? boards.map((b) => BOARDS[b as keyof typeof BOARDS]).join(', ') : 'every job board that’s on'}`, user.id);
  return Response.json({ ok: true, boards });
});
