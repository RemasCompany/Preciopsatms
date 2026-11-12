import { z } from 'zod';
import { requireApiContext, withApi } from '@/lib/tenant';
import { calculateFromClock } from '@/lib/differentials-server';

const Body = z.object({ applicationId: z.string().min(1), week: z.string() });

/** Work out night, weekend and holiday hours from the week's time clock punches. */
export const POST = withApi(async (req: Request) => {
  const ctx = await requireApiContext({ minRole: 'RECRUITER', feature: 'timesheets', write: true });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: 'Invalid input' }, { status: 400 });
  return Response.json(await calculateFromClock(ctx, b.data.applicationId, b.data.week));
});
