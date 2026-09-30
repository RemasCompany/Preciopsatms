import { z } from 'zod';
import { db } from '@/lib/db';
import { consumeToken } from '@/lib/account';

/** Confirms an email address from the link in the verification email. */
export async function POST(req: Request) {
  const b = z.object({ token: z.string().min(10).max(100) }).safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: 'This link isn’t valid.' }, { status: 400 });
  const user = await consumeToken(b.data.token, 'verify');
  if (!user) return Response.json({ error: 'This link has expired or was already used. Sign in and ask for a new one.' }, { status: 404 });
  if (!user.emailVerifiedAt) await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  return Response.json({ ok: true, email: user.email });
}
