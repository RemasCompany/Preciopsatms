import { requireApiContext, withApi } from '@/lib/tenant';
import { requireRefresher } from '@/lib/training-server';

/** Require refresher training (after an incident, a near-miss, a new truck type…). Puts the certification on hold. */
export const POST = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'training', write: true });
  return Response.json(await requireRefresher(org, user, await req.json().catch(() => null)), { status: 201 });
});
