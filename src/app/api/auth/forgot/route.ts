import { z } from 'zod';
import { db } from '@/lib/db';
import { limited } from '@/lib/rate-limit';
import { sendPasswordReset } from '@/lib/account';

const Body = z.object({ email: z.string().trim().toLowerCase().email('Enter your email address.') });

/** Emails a reset link. Always answers the same way so it can't be used to find out who has an account. */
export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: b.error.issues[0].message }, { status: 400 });
  if (limited('forgot-ip', ip, 10, 3600e3) || limited('forgot-email', b.data.email, 3, 3600e3)) return Response.json({ error: 'Too many requests. Try again in an hour.' }, { status: 429 });
  const user = await db.user.findUnique({ where: { email: b.data.email } });
  if (user) await sendPasswordReset(user).catch((e) => console.error('[forgot] email failed', e));
  return Response.json({ ok: true, message: 'If there’s an account for that email, we’ve sent a link to reset the password. Check your inbox (and spam).' });
}
