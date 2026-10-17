import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { ProgramBody, createProgram, programView } from '@/lib/vms-server';

/** The firm's client VMS programs (SAP Fieldglass, Beeline, Workday VNDLY, others). */
export const GET = withApi(async () => {
  const { tdb } = await requireApiContext({ feature: 'vms' });
  const rows = await tdb.vmsProgram.findMany({ include: { client: { select: { name: true } }, _count: { select: { jobs: true } } }, orderBy: { createdAt: 'asc' } });
  return Response.json({ programs: rows.map(programView) });
});

export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'vms', write: true });
  const p = ProgramBody.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? 'Invalid input');
  const prog = await createProgram(tdb, org, user, p.data);
  return Response.json({ ok: true, id: prog.id }, { status: 201 });
});
