import { z } from 'zod';
import { requireApiContext, withApi } from '@/lib/tenant';
import { setupSso, ssoStatus, turnOff } from '@/lib/sso';

export const dynamic = 'force-dynamic';
const admin = (write = false) => requireApiContext({ minRole: 'ADMIN', feature: 'sso', write });

export const GET = withApi(async () => {
  const { tdb, org } = await admin();
  return Response.json(await ssoStatus(tdb, org));
});

/** Step 1: the company's email domains (creates its WorkOS organization). */
export const POST = withApi(async (req: Request) => {
  const { org, user } = await admin(true);
  const b = z.object({ domains: z.array(z.string().max(253)).max(10) }).parse(await req.json());
  return Response.json({ domains: await setupSso(org, user, b.domains) });
});

/** Turns single sign-on off: people sign in with their passwords again. */
export const DELETE = withApi(async () => {
  const { org, user } = await admin(true);
  await turnOff(org, user);
  return Response.json({ ok: true });
});
