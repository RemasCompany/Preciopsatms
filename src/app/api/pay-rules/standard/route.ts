import { requireApiContext, withApi } from '@/lib/tenant';
import { addStandardRules } from '@/lib/differentials-server';

/** Add the usual healthcare differentials (night, weekend, holiday, on call); kinds already set up are skipped. */
export const POST = withApi(async () => {
  const ctx = await requireApiContext({ minRole: 'ADMIN', feature: 'timesheets', write: true });
  return Response.json(await addStandardRules(ctx), { status: 201 });
});
