import { z } from 'zod';
import { requireApiContext, withApi } from '@/lib/tenant';
import { setJobCerts } from '@/lib/training-server';
import { CREDENTIAL_TYPE_NAMES } from '@/lib/credentials';

const Body = z.object({
  requiredCerts: z.array(z.string().refine((t) => t !== 'Other' && CREDENTIAL_TYPE_NAMES.includes(t), 'Choose a credential from the list.')).max(20, 'That’s more than 20 requirements — keep the ones that matter.'),
});

/** Set the credentials a job requires. Admins only, since this stops placements and shifts. */
export const PATCH = withApi(async (req: Request, { params }: { params: { id: string } }) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'credentials', write: true });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: b.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  const requiredCerts = await setJobCerts(tdb, org, user, params.id, b.data.requiredCerts);
  return Response.json({ ok: true, requiredCerts });
});
