import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { endDeduction } from '@/lib/deductions-server';

type Ctx = { params: { id: string } };
const Body = z.object({ endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the last date it applies.') });

/** End a recurring deduction from a date (runs paid after it don’t take it). */
export const PATCH = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'payrollRuns', write: true });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? 'Invalid input');
  await endDeduction(tdb, org, user, params.id, p.data.endDate);
  return Response.json({ ok: true });
});
