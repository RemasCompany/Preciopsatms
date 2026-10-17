import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { sendSetupLink } from '@/lib/payroll-provider';

type Ctx = { params: { candidateId: string } };
const Body = z.object({ channels: z.array(z.enum(['email', 'sms'])).min(1, 'Choose email or text.') });

/** Email or text a worker their private link to set up tax withholding and direct deposit in Check. */
export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'payrollRuns', write: true });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? 'Invalid input');
  const r = await sendSetupLink(tdb, org, params.candidateId, p.data.channels, user);
  if (!r.sent.length) throw new HttpError(400, r.problems.join(' ') || 'Nothing was sent.');
  return Response.json({ ok: true, ...r });
});
