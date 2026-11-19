/** Is email set up on this server? Names the settings, never their values. */
export function emailStatus(env: Record<string, string | undefined> = process.env) {
  const key = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!key || /^re_\.\.\.$/.test(key)) return { ok: false, summary: 'Email isn’t set up: RESEND_API_KEY is missing, so the live site sends no email at all (sign-up confirmations, password resets, invites, reminders, notices). Add it in Vercel → Settings → Environment Variables (Production) and redeploy.' };
  if (!/^re_/.test(key)) return { ok: false, summary: 'RESEND_API_KEY doesn’t look like a Resend API key (it starts with re_).' };
  if (!from) return { ok: false, summary: 'EMAIL_FROM is missing. Set it to Preciops <notifications@mail.preciopsatms.com> in Vercel (Production) and redeploy.' };
  const address = from.replace(/.*</, '').replace('>', '');
  return { ok: true, summary: `Email is set up: the site sends from ${address}. Use “Send me a test email” to confirm it arrives.`, from: address };
}
