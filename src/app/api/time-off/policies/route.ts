import { requireApiContext, withApi } from '@/lib/tenant';
import { savePolicy } from '@/lib/leave';

export const GET = withApi(async () => {
  const { tdb } = await requireApiContext({ feature: 'timeoff' });
  return Response.json(await tdb.leavePolicy.findMany({ orderBy: [{ archived: 'asc' }, { name: 'asc' }] }));
});

/** Add a time-off policy (vacation, sick, unpaid…). Owners and admins. */
export const POST = withApi(async (req: Request) => {
  const ctx = await requireApiContext({ minRole: 'ADMIN', feature: 'timeoff', write: true });
  return Response.json(await savePolicy(ctx, null, await req.json().catch(() => null)), { status: 201 });
});
