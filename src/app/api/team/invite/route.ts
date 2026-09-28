import { z } from 'zod';
import { db } from '@/lib/db';
import { requireApiContext, withApi, HttpError, logActivity } from '@/lib/tenant';
import { seatLimitReached } from '@/lib/stripe';
import { newToken, sha256 } from '@/lib/tokens';
import { sendEmail } from '@/lib/email';

const Body = z.object({ email: z.string().trim().email('Enter a valid email address.'), role: z.enum(['ADMIN', 'RECRUITER', 'VIEWER']) });

/** Invite a teammate. Seats sync to Stripe when the invite is accepted at /invite/[token]. */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', write: true });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
  const email = parsed.data.email.toLowerCase();
  if (await db.membership.findFirst({ where: { organizationId: org.id, user: { email } } })) throw new HttpError(409, 'That person is already on your team.');
  const members = await db.membership.count({ where: { organizationId: org.id } });
  if (seatLimitReached(org, members)) throw new HttpError(402, 'Your plan includes 3 users. Upgrade to Growth to add more.');

  const token = newToken();
  await tdb.invite.deleteMany({ where: { email, acceptedAt: null } }); // re-inviting replaces the old link
  const invite = await tdb.invite.create({ data: { email, role: parsed.data.role, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 864e5) } as never });
  try {
    await sendEmail({ to: email, replyTo: user.email, fromName: org.shortName ?? org.name, subject: `${user.name ?? 'A teammate'} invited you to ${org.shortName ?? org.name} on Preciops`,
      text: `You've been invited to join ${org.name} on Preciops.\n\nAccept: ${process.env.APP_URL}/invite/${token}\n\nThis link expires in 7 days.` });
  } catch (e) {
    await tdb.invite.deleteMany({ where: { id: invite.id } }); // nobody received the link
    console.error('[invite] email failed', e);
    throw new HttpError(502, 'The invite email couldn’t be sent. Check the address and try again.');
  }
  await logActivity(org.id, `Invited ${email} as ${parsed.data.role.toLowerCase()}`, user.id);
  return Response.json({ ok: true });
});
