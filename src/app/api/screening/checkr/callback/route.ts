import { requireApiContext, HttpError } from '@/lib/tenant';
import { connectAccount } from '@/lib/checkr';
import { readState } from '@/lib/secret-box';

export const dynamic = 'force-dynamic';
const back = (q: string) => Response.redirect(`${process.env.APP_URL ?? 'http://localhost:3000'}/app/settings?${q}#screening`, 302);

/** Checkr's redirect after connecting (the redirect_uri registered with Checkr). The signed state must match the signed-in admin and company. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  try {
    const { org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'credentials', write: true });
    const st = readState(u.searchParams.get('state'));
    if (!st || st.org !== org.id || st.user !== user.id || st.p !== 'checkr') throw new HttpError(400, 'That connection link expired. Start again from Settings.');
    if (u.searchParams.get('error')) throw new HttpError(400, 'The Checkr connection was cancelled.');
    const code = u.searchParams.get('code');
    if (!code) throw new HttpError(400, 'No authorization code came back from Checkr. Start again from Settings.');
    const r = await connectAccount(org, user, code);
    return back(`screening=${r.credentialed ? 'ready' : 'pending'}`);
  } catch (e) {
    return back(`screening_error=${encodeURIComponent(e instanceof HttpError ? e.message : 'Something went wrong connecting Checkr. Try again.')}`);
  }
}
