import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { approveInProvider, refreshRun, sendRun } from '@/lib/payroll-provider';

type Ctx = { params: { id: string } };
const Body = z.object({ action: z.enum(['send', 'approve', 'refresh']) });

/** Send an approved run to Check (draft + tax preview), approve it there, or re-read its status. */
export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'payrollRuns', write: true });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, 'Invalid input');
  if (p.data.action === 'send') {
    const r = await sendRun(tdb, org, user, params.id);
    return Response.json(r, { status: r.ok ? 200 : 409 });
  }
  if (p.data.action === 'approve') return Response.json({ ok: true, ...(await approveInProvider(tdb, org, user, params.id)) });
  const status = await refreshRun(org.id, params.id);
  if (!status) throw new HttpError(400, 'This run hasn’t been sent to Check.');
  return Response.json({ ok: true, status });
});
