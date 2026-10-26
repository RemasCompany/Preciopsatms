import { HttpError } from '@/lib/tenant';
import { finishLogin } from '@/lib/sso';
import { captureError } from '@/lib/monitoring';

export const dynamic = 'force-dynamic';
const to = (path: string) => Response.redirect(`${process.env.APP_URL ?? 'http://localhost:3000'}${path}`, 302);

/** WorkOS sends people back here after they sign in with their identity provider (register this as the redirect URI). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  try {
    const err = u.searchParams.get('error');
    if (err) throw new HttpError(400, u.searchParams.get('error_description') ?? 'Single sign-on was cancelled.');
    const code = u.searchParams.get('code');
    if (!code) throw new HttpError(400, 'Single sign-on didn’t finish. Try again.');
    const { ticket } = await finishLogin(code, u.searchParams.get('state'));
    return to(`/sso?ticket=${encodeURIComponent(ticket)}`);
  } catch (e) {
    if (!(e instanceof HttpError)) await captureError(e, { route: '/api/auth/sso/callback', method: 'GET' });
    return to(`/login?sso_error=${encodeURIComponent(e instanceof HttpError ? e.message.slice(0, 300) : 'Single sign-on didn’t work. Try again or use your password.')}`);
  }
}
