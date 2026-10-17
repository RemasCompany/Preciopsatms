import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { MappingBody, getProgram, importRemittance, planRemittance } from '@/lib/vms-server';

type Ctx = { params: { id: string } };
const Body = z.object({
  text: z.string().min(1, 'Choose the remittance file (CSV).').max(5_000_000, 'That file is larger than 5 MB.'),
  mapping: MappingBody.shape.remittance, commit: z.boolean().default(false),
});

/** Preview (default) or record a VMS remittance against the client's invoices. */
export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'vms', write: true });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? 'Invalid input');
  const prog = await getProgram(tdb, params.id);
  if (!p.data.commit) return Response.json(await planRemittance(tdb, prog, p.data.text, p.data.mapping as never));
  return Response.json({ ok: true, ...(await importRemittance(tdb, org, user, prog, p.data.text, p.data.mapping as never)) });
});
