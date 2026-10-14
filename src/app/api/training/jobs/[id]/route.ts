import { z } from 'zod';
import { requireApiContext, withApi } from '@/lib/tenant';
import { setJobCerts } from '@/lib/training-server';
import { EQUIPMENT_TYPES } from '@/lib/training';

const Body = z.object({ requiredCerts: z.array(z.string().refine((t) => EQUIPMENT_TYPES.includes(t), 'Unknown certification.')).max(10) });

/** Set the certifications a job requires. Admins only, since this drives the placement and scheduling warnings. */
export const PATCH = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'training', write: true });
  await setJobCerts(tdb, org, user, params.id, Body.parse(await req.json().catch(() => null)).requiredCerts);
  return Response.json({ ok: true });
});
