import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { ProgramPatch, getProgram, updateProgram } from '@/lib/vms-server';
import { audit } from '@/lib/audit';

type Ctx = { params: { id: string } };

/** Change a program's details, saved column layouts or rate codes. */
export const PATCH = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'vms', write: true });
  const p = ProgramPatch.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? 'Invalid input');
  await updateProgram(tdb, org, user, await getProgram(tdb, params.id), p.data);
  return Response.json({ ok: true });
});

/** Removes the program; its jobs stay (they just stop being linked to it). */
export const DELETE = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'vms', write: true });
  const prog = await getProgram(tdb, params.id);
  await tdb.job.updateMany({ where: { vmsProgramId: prog.id }, data: { vmsProgramId: null } });
  await tdb.vmsProgram.deleteMany({ where: { id: prog.id } });
  await audit(org.id, user, 'vms.program', `Removed the VMS program “${prog.name}”`, { targetType: 'vmsProgram', targetId: prog.id, req });
  return Response.json({ ok: true });
});
