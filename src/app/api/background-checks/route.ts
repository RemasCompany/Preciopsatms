import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { OrderBody, orderCheck } from '@/lib/checkr';

/** Order a background check for a candidate (Checkr invitation). */
export const POST = withApi(async (req: Request) => {
  const { org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'credentials', write: true });
  const b = OrderBody.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'Invalid input');
  const bc = await orderCheck(org, user, b.data);
  return Response.json({ id: bc.id }, { status: 201 });
});

/** A candidate's checks. */
export const GET = withApi(async (req: Request) => {
  const { tdb } = await requireApiContext({ minRole: 'RECRUITER', feature: 'credentials' });
  const candidateId = new URL(req.url).searchParams.get('candidate') ?? '';
  const rows = await tdb.backgroundCheck.findMany({ where: { candidateId }, orderBy: { orderedAt: 'desc' }, select: { id: true, package: true, status: true, orderedAt: true, completedAt: true, externalReportId: true } });
  return Response.json({ checks: rows, dashboard: process.env.CHECKR_ENV === 'production' ? 'https://dashboard.checkr.com' : 'https://dashboard.checkr-staging.com' });
});
