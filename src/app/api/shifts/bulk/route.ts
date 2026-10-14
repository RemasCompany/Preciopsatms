import { requireApiContext, withApi } from '@/lib/tenant';
import { bulkRemove, bulkUpdate, createPlanned, planShifts } from '@/lib/schedule-bulk';

const ctx = () => requireApiContext({ minRole: 'RECRUITER', feature: 'scheduling', write: true });

/** Create schedule: `dryRun: true` checks the batch and returns a preview; otherwise every shift is added, or none. */
export const POST = withApi(async (req: Request) => {
  const c = await ctx();
  const raw = await req.json().catch(() => null);
  if (raw?.dryRun) {
    const { items } = await planShifts(c, raw);
    return Response.json({ items });
  }
  return Response.json(await createPlanned(c, raw), { status: 201 });
});

/** Change times, move to other days, or hand to another worker, for many shifts at once. */
export const PATCH = withApi(async (req: Request) => Response.json(await bulkUpdate(await ctx(), await req.json().catch(() => null))));

/** Remove many shifts: unsent ones are deleted, sent ones become cancellations. */
export const DELETE = withApi(async (req: Request) => Response.json(await bulkRemove(await ctx(), await req.json().catch(() => null))));
