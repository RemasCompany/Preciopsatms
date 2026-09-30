import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { ScheduleBody, createSchedule } from '@/lib/reports-server';

/** Email a report weekly or monthly (owners and admins). */
export const POST = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', write: true });
  const b = ScheduleBody.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'Invalid input');
  const s = await createSchedule(org, user, b.data);
  return Response.json({ id: s.id }, { status: 201 });
});
