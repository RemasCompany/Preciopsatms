import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { authorizeUrl, isProvider, providerEnabled, PROVIDERS } from '@/lib/accounting';
import { signState } from '@/lib/secret-box';

export const dynamic = 'force-dynamic';

/** Starts OAuth with QuickBooks or Xero (admins). */
export const GET = withApi(async (_req: Request, { params }: { params: { provider: string } }) => {
  if (!isProvider(params.provider)) throw new HttpError(404, 'Not found');
  const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'timesheets', write: true });
  if (!providerEnabled(params.provider)) throw new HttpError(503, `${PROVIDERS[params.provider].name} isn’t set up on this server yet.`);
  return Response.redirect(authorizeUrl(params.provider, signState({ org: org.id, user: user.id, p: params.provider })), 302);
});
