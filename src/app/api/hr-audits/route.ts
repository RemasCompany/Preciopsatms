import { z } from 'zod';
import { requireApiContext, withApi } from '@/lib/tenant';
import { listAudits, startAudit } from '@/lib/hr-audit-server';

const admin = (write = false) => requireApiContext({ minRole: 'ADMIN', feature: 'hrAudit', write });

export const GET = withApi(async () => {
  const { tdb } = await admin();
  return Response.json({ audits: await listAudits(tdb) });
});

/** Starts an audit: runs the automatic checks and opens the checklist. One open audit at a time. */
export const POST = withApi(async (req: Request) => {
  const ctx = await admin(true);
  const b = z.object({ title: z.string().trim().max(120).optional() }).parse(await req.json().catch(() => ({})));
  return Response.json({ id: await startAudit(ctx, b.title) }, { status: 201 });
});
