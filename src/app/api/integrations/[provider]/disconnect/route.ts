import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { disconnect, isProvider } from '@/lib/accounting';

export const POST = withApi(async (_req: Request, { params }: { params: { provider: string } }) => {
  if (!isProvider(params.provider)) throw new HttpError(404, 'Not found');
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'timesheets', write: true });
  await disconnect(org, user, params.provider);
  return Response.json({ ok: true });
});
