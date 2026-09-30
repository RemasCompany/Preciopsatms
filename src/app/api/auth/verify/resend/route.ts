import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { limited } from '@/lib/rate-limit';
import { sendVerification } from '@/lib/account';

/** Sends the signed-in user a new verification email. */
export const POST = withApi(async () => {
  const { user } = await requireApiContext({});
  if (user.emailVerifiedAt) return Response.json({ ok: true, already: true });
  if (await limited('verify-resend', user.id, 5, 3600e3)) throw new HttpError(429, 'We’ve sent a few already. Check your spam folder, or try again in an hour.');
  await sendVerification(user).catch(() => { throw new HttpError(502, 'The email couldn’t be sent. Try again in a minute.'); });
  return Response.json({ ok: true, message: `We sent a new link to ${user.email}.` });
});
