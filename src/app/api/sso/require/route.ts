import { z } from 'zod';
import { requireApiContext, withApi } from '@/lib/tenant';
import { setRequired } from '@/lib/sso';

/** Require single sign-on for everyone except owners, who keep their password as a way back in. */
export const PATCH = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'sso', write: true });
  const b = z.object({ required: z.boolean() }).parse(await req.json());
  await setRequired(org, user, b.required);
  return Response.json({ ok: true });
});
