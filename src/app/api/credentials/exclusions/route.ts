import { requireApiContext, withApi } from '@/lib/tenant';
import { SettingsBody, setScreening } from '@/lib/exclusions-server';

/** Turn monthly OIG exclusion screening on or off. */
export const PATCH = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'credentials', write: true });
  const b = SettingsBody.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: 'Invalid input' }, { status: 400 });
  await setScreening(org, user, b.data.enabled);
  return Response.json({ ok: true });
});
