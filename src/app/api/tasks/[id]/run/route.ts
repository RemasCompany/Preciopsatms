import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { runTask } from '@/lib/task-runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Starts a task you just queued, in this request. If the browser goes away, the scheduled job finishes it. */
export const POST = withApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const { tdb, user } = await requireApiContext({ write: true });
  if (!(await tdb.backgroundTask.findFirst({ where: { id: params.id, createdById: user.id } }))) throw new HttpError(404, 'That send wasn’t found.');
  return Response.json({ started: await runTask(params.id) });
});
