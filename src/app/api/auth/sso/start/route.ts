import { z } from 'zod';
import { limited } from '@/lib/rate-limit';
import { startLogin } from '@/lib/sso';

/** "Sign in with SSO": where to send this email address, if its company uses single sign-on. */
export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  if (await limited('sso-start', ip, 30, 15 * 60e3)) return Response.json({ error: 'Too many tries. Wait a few minutes and try again.' }, { status: 429 });
  const b = z.object({ email: z.string().trim().email('Enter your work email.').max(200) }).safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: b.error.issues[0].message }, { status: 400 });
  const url = await startLogin(b.data.email);
  if (!url) return Response.json({ error: 'Your company doesn’t sign in with single sign-on here. Use your email and password.' }, { status: 404 });
  return Response.json({ url });
}
