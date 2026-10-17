import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { PlacementIdsBody, getProgram, programPlacements, setPlacementIds } from '@/lib/vms-server';

type Ctx = { params: { id: string } };

/** Placements on the program's jobs, and their VMS work order / worker IDs. */
export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb } = await requireApiContext({ feature: 'vms' });
  return Response.json({ placements: await programPlacements(tdb, await getProgram(tdb, params.id)) });
});

export const PATCH = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb } = await requireApiContext({ feature: 'vms', write: true });
  const p = PlacementIdsBody.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? 'Invalid input');
  await setPlacementIds(tdb, await getProgram(tdb, params.id), p.data);
  return Response.json({ ok: true });
});
