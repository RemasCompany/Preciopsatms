/** Which settings are missing, and what that turns off. Logged once when the server starts. */
export function configReport(env: Record<string, string | undefined> = process.env) {
  const set = (k: string) => !!env[k] && !/^(|\.\.\.|sk_test_\.\.\.|whsec_\.\.\.|price_\.\.\.|re_\.\.\.|sk-ant-\.\.\.|AC\.\.\.|MG\.\.\.|generate-with.*)$/.test(env[k]!.trim());
  const errors: string[] = [], warnings: string[] = [];
  for (const k of ['DATABASE_URL', 'NEXTAUTH_SECRET', 'NEXTAUTH_URL', 'APP_URL']) if (!set(k)) errors.push(`${k} is required.`);
  if (set('NEXTAUTH_SECRET') && env.NEXTAUTH_SECRET!.length < 32) errors.push('NEXTAUTH_SECRET should be at least 32 characters (openssl rand -base64 32).');
  if (set('APP_URL') && env.NODE_ENV === 'production' && !env.APP_URL!.startsWith('https://')) warnings.push('APP_URL should use https:// in production (Indeed Apply and signing links require it).');
  if (!set('STRIPE_SECRET_KEY')) warnings.push('Stripe is not configured: signups run on the free trial and plans can’t be purchased.');
  else if (!set('STRIPE_WEBHOOK_SECRET')) errors.push('STRIPE_WEBHOOK_SECRET is required when Stripe is on, or subscriptions won’t sync.');
  else for (const k of ['STRIPE_PRICE_STARTER', 'STRIPE_PRICE_GROWTH', 'STRIPE_PRICE_ENTERPRISE']) if (!set(k)) warnings.push(`${k} is missing: that plan can’t be purchased.`);
  if (!set('RESEND_API_KEY')) warnings.push('Resend is not configured: emails (invites, signing links, applicant notices) are not sent.');
  else if (!set('EMAIL_FROM')) errors.push('EMAIL_FROM is required when Resend is on.');
  if (env.STORAGE_DRIVER === 'local') { if (env.NODE_ENV === 'production') warnings.push('STORAGE_DRIVER=local keeps files on this server’s disk; on Vercel and most hosts that disk is wiped. Use S3 or R2.'); }
  else if (!set('S3_BUCKET') || !set('S3_ACCESS_KEY_ID') || !set('S3_SECRET_ACCESS_KEY')) warnings.push('File storage is not configured: resume uploads and signed PDFs will fail. Set the S3_* variables.');
  if (!set('ANTHROPIC_API_KEY')) warnings.push('ANTHROPIC_API_KEY is missing: resume parsing and lead scoring are off.');
  if (!set('CRON_SECRET')) warnings.push('CRON_SECRET is missing: the daily credential-expiration emails, shift reminders and birthday greetings can’t run.');
  if (!set('TWILIO_ACCOUNT_SID')) warnings.push('Twilio is not configured: text messages are not sent.');
  if (!set('SENTRY_DSN')) warnings.push('SENTRY_DSN is missing: server and browser errors are only written to the logs.');
  if (set('UPSTASH_REDIS_REST_URL') !== set('UPSTASH_REDIS_REST_TOKEN')) warnings.push('Set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or neither.');
  else if (!set('UPSTASH_REDIS_REST_URL') && env.NODE_ENV === 'production') warnings.push('Upstash is not configured: rate limits are counted per server instance, which is weaker when you run several.');
  return { errors, warnings };
}
