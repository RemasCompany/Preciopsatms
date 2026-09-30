import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { limited } from '@/lib/rate-limit';
import { consumeToken, peekToken } from '@/lib/account';

const Body = z.object({ token: z.string().min(10).max(100), password: z.string().min(10, 'Use at least 10 characters.').max(200, 'That password is too long.') });

/** Is the link still good? (For the reset page, before the user types a new password.) */
export async function GET(req: Request) {
  const t = await peekToken(new URL(req.url).searchParams.get('token') ?? '', 'reset');
  return t ? Response.json({ ok: true, email: t.user.email }) : Response.json({ error: 'This reset link has expired or was already used. Ask for a new one.' }, { status: 404 });
}

/** Sets the new password, signs out every other session and confirms the email (they proved they own the inbox). */
export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  if (limited('reset', ip, 20, 3600e3)) return Response.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: b.error.issues[0].message }, { status: 400 });
  const user = await consumeToken(b.data.token, 'reset');
  if (!user) return Response.json({ error: 'This reset link has expired or was already used. Ask for a new one.' }, { status: 404 });
  const now = new Date();
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(b.data.password, 12), passwordChangedAt: now, emailVerifiedAt: user.emailVerifiedAt ?? now } });
  const orgs = await db.membership.findMany({ where: { userId: user.id }, select: { organizationId: true } });
  if (orgs.length) await db.activity.createMany({ data: orgs.map((o) => ({ organizationId: o.organizationId, text: `${user.name ?? user.email} reset their password`, actorId: user.id })) });
  return Response.json({ ok: true, email: user.email });
}
