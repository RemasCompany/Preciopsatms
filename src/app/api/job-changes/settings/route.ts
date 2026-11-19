import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { db } from '@/lib/db';

/** Whether managers' job changes wait for an owner or admin to approve them. */
export const PATCH = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'people', write: true });
  const b = z.object({ approval: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, 'Choose on or off.');
  await db.organization.update({ where: { id: org.id }, data: { jobChangeApproval: b.data.approval } });
  await audit(org.id, user, 'employee.job_change', b.data.approval ? 'Managers’ job changes now need approval' : 'Managers’ job changes now apply without approval', { changes: { jobChangeApproval: [org.jobChangeApproval, b.data.approval] } });
  return Response.json({ ok: true });
});
