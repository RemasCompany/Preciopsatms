import { z } from 'zod';
import { requireApiContext, withApi, logActivity } from '@/lib/tenant';
import { db } from '@/lib/db';
import { parse } from '@/lib/engagement-server';
import { audit, diff } from '@/lib/audit';

/** Whether workers on assignment get an automatic birthday greeting. */
export const PATCH = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'engagement', write: true });
  const { birthdayGreetings } = parse(z.object({ birthdayGreetings: z.boolean() }), await req.json().catch(() => null));
  await db.organization.update({ where: { id: org.id }, data: { birthdayGreetings } });
  await logActivity(org.id, `Turned automatic birthday greetings ${birthdayGreetings ? 'on' : 'off'}`, user.id);
  await audit(org.id, user, 'settings.engagement', `Turned automatic birthday greetings ${birthdayGreetings ? 'on' : 'off'}`, { changes: diff(org, { birthdayGreetings }), req });
  return Response.json({ ok: true });
});
