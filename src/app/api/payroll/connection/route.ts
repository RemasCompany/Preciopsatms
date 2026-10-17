import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { ConnectBody, companySetupUrl, connectCompany, disconnect, getConnection, refreshCompany } from '@/lib/payroll-provider';
import { checkEnabled, checkLive } from '@/lib/check-payroll';

/** The firm's payroll processing connection (Check): status, connect, open company setup, disconnect. */
export const GET = withApi(async () => {
  const { tdb } = await requireApiContext({ minRole: 'ADMIN', feature: 'payrollRuns' });
  const conn = await getConnection(tdb);
  if (!conn) return Response.json({ available: checkEnabled(), live: checkLive(), connection: null });
  const co = await refreshCompany(tdb, conn);
  return Response.json({ available: checkEnabled(), live: checkLive(), connection: { companyId: conn.companyId, companyName: conn.companyName, connectedAt: conn.connectedAt.toISOString(), ...co } });
});

const Action = z.object({ action: z.literal('setupUrl') });
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'payrollRuns', write: true });
  const body = await req.json().catch(() => null);
  if (Action.safeParse(body).success) return Response.json({ url: await companySetupUrl(tdb) });
  const p = ConnectBody.safeParse(body);
  if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? 'Invalid input');
  return Response.json({ ok: true, ...(await connectCompany(tdb, org, user, p.data)) });
});

export const DELETE = withApi(async () => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'OWNER', feature: 'payrollRuns', write: true });
  await disconnect(tdb, org, user);
  return Response.json({ ok: true });
});
