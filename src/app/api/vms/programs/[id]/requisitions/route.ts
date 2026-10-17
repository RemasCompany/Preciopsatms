import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { MappingBody, getProgram, importRequisitions, planRequisitions } from '@/lib/vms-server';

type Ctx = { params: { id: string } };
const Body = z.object({
  text: z.string().min(1, 'Choose the requisition export (CSV).').max(5_000_000, 'That file is larger than 5 MB. Export fewer requisitions at a time.'),
  mapping: MappingBody.shape.requisitions, commit: z.boolean().default(false),
});

/** Preview (default) or import a requisition export from the program's VMS. Choosing columns saves them for next time. */
export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'vms', write: true });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? 'Invalid input');
  const prog = await getProgram(tdb, params.id);
  if (!p.data.commit) return Response.json(await planRequisitions(tdb, prog, p.data.text, p.data.mapping as never));
  return Response.json({ ok: true, ...(await importRequisitions(tdb, org, user, prog, p.data.text, p.data.mapping as never)) });
});
