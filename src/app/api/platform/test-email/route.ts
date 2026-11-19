import { withApi, HttpError } from '@/lib/tenant';
import { requirePlatformApi } from '@/lib/platform';
import { sendEmail } from '@/lib/email';
import { emailStatus } from '@/lib/email-status';
import { SALES_EMAIL } from '@/lib/contact';

/** Sends a test email to the platform admin, to prove the live site's email works end to end. */
export const POST = withApi(async () => {
  const admin = await requirePlatformApi();
  const s = emailStatus();
  if (!s.ok) throw new HttpError(503, s.summary);
  try {
    await sendEmail({ to: admin.email, subject: 'Preciops test email', text: `This test came from the live Preciops site, sent by its email settings.\n\nIf you're reading it, sign-up confirmations, password resets, invites and reminders are going out.\n\n— Preciops`, fromName: 'Preciops', replyTo: SALES_EMAIL });
  } catch (e) { throw new HttpError(502, `Resend refused the email: ${(e as Error).message.slice(0, 200)}. Check the API key and that the sending domain is verified in Resend.`); }
  return Response.json({ ok: true, message: `Sent to ${admin.email}. If it doesn’t arrive in a minute, check spam, then the Resend dashboard’s Emails list.` });
});
