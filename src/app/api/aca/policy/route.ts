import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { PolicyBody, savePolicy } from '@/lib/aca-server';

/** The company's ACA look-back measurement settings. */
export const PATCH = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'aca', write: true });
  const p = PolicyBody.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, 'Choose a length for each period.');
  await savePolicy(tdb, org, user, p.data);
  return Response.json({ ok: true });
});
