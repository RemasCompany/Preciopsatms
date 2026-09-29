import { requireApiContext, withApi } from '@/lib/tenant';
import { db } from '@/lib/db';

/** People on the team, for "Owner" pickers: { me, options: [{ id, label }] }. */
export const GET = withApi(async () => {
  const { org, user } = await requireApiContext({});
  const members = await db.membership.findMany({ where: { organizationId: org.id }, select: { user: { select: { id: true, name: true, email: true } } } });
  const options = members.map((m) => ({ id: m.user.id, label: m.user.name || m.user.email })).sort((a, b) => a.label.localeCompare(b.label));
  return Response.json({ me: user.id, options });
});
