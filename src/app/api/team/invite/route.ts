import { z } from 'zod';
import { db } from '@/lib/db';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { seatLimitReached } from '@/lib/stripe';
import { newToken, sha256 } from '@/lib/tokens';
import { sendEmail } from '@/lib/email';

/** Invite a teammate. Seats sync to Stripe when the invite is accepted (see /invite/[token] — TODO in CLAUDE.md). */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', write: true });
  const b = z.object({ email: z.string().email(), role: z.enum(['ADMIN', 'RECRUITER', 'VIEWER']) }).parse(await req.json());
  const members = await db.membership.count({ where: { organizationId: org.id } });
  if (seatLimitReached(org, members)) throw new HttpError(402, 'Your plan includes 3 users. Upgrade to Growth to add more.');
  const token = newToken();
  await tdb.invite.create({ data: { email: b.email.toLowerCase(), role: b.role, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 864e5) } as never });
  await sendEmail({ to: b.email, subject: `${user.name ?? 'A teammate'} invited you to ${org.shortName ?? org.name} on Preciops`,
    text: `You've been invited to join ${org.name} on Preciops.\n\nAccept: ${process.env.APP_URL}/invite/${token}\n\nThis link expires in 7 days.` });
  return Response.json({ ok: true });
});
