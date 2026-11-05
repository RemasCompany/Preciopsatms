import { requireApiContext, withApi } from '@/lib/tenant';
import { saveAutomation } from '@/lib/automation-server';

/** Turn hiring automations on or off and set how they work. Admins only. */
export const PATCH = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', write: true });
  await saveAutomation(org, user, await req.json().catch(() => null));
  return Response.json({ ok: true });
});
