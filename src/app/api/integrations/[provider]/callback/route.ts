import { requireApiContext, HttpError } from '@/lib/tenant';
import { connect, isProvider, PROVIDERS } from '@/lib/accounting';
import { readState } from '@/lib/secret-box';

export const dynamic = 'force-dynamic';
const back = (q: string) => Response.redirect(`${process.env.APP_URL ?? 'http://localhost:3000'}/app/settings?${q}#accounting`, 302);

/** OAuth return from QuickBooks or Xero. The signed state must match the signed-in admin and company. */
export async function GET(req: Request, { params }: { params: { provider: string } }) {
  if (!isProvider(params.provider)) return new Response('Not found', { status: 404 });
  const u = new URL(req.url);
  try {
    const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'timesheets', write: true });
    const st = readState(u.searchParams.get('state'));
    if (!st || st.org !== org.id || st.user !== user.id || st.p !== params.provider) throw new HttpError(400, 'That connection link expired. Start again from Settings.');
    if (u.searchParams.get('error')) throw new HttpError(400, `${PROVIDERS[params.provider].name} connection was cancelled.`);
    const code = u.searchParams.get('code');
    if (!code) throw new HttpError(400, 'No authorization code came back. Start again from Settings.');
    await connect(org, user, params.provider, code, u.searchParams.get('realmId'));
    return back('accounting=connected');
  } catch (e) {
    return back(`accounting_error=${encodeURIComponent(e instanceof HttpError ? e.message : 'Something went wrong connecting. Try again.')}`);
  }
}
