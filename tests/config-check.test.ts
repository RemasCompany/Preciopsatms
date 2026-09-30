import { describe, expect, it } from 'vitest';
import { configReport } from '@/lib/config-check';

const base = { DATABASE_URL: 'postgresql://x', NEXTAUTH_SECRET: 'a'.repeat(44), NEXTAUTH_URL: 'https://app.test', APP_URL: 'https://app.test', NODE_ENV: 'production' };

describe('startup config report', () => {
  it('flags missing essentials and treats .env.example placeholders as missing', () => {
    const r = configReport({ NEXTAUTH_SECRET: 'generate-with: openssl rand -base64 32', STRIPE_SECRET_KEY: 'sk_test_...' });
    expect(r.errors).toEqual(['DATABASE_URL is required.', 'NEXTAUTH_SECRET is required.', 'NEXTAUTH_URL is required.', 'APP_URL is required.']);
    expect(r.warnings.some((w) => w.startsWith('Stripe is not configured'))).toBe(true);
  });
  it('explains what each missing integration turns off', () => {
    const r = configReport(base);
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.split(':')[0])).toEqual(['Stripe is not configured', 'Resend is not configured', 'File storage is not configured', 'ANTHROPIC_API_KEY is missing', 'CRON_SECRET is missing', 'Twilio is not configured', 'SENTRY_DSN is missing', 'Upstash is not configured']);
  });
  it('requires the partner secrets that make an integration work', () => {
    const r = configReport({ ...base, STRIPE_SECRET_KEY: 'sk_live_abcdefghijkl', RESEND_API_KEY: 're_abc123' });
    expect(r.errors).toEqual(['STRIPE_WEBHOOK_SECRET is required when Stripe is on, or subscriptions won’t sync.', 'EMAIL_FROM is required when Resend is on.']);
  });
  it('warns about local file storage and http in production', () => {
    const r = configReport({ ...base, APP_URL: 'http://app.test', STORAGE_DRIVER: 'local' });
    expect(r.warnings.filter((w) => /STORAGE_DRIVER|https/.test(w))).toHaveLength(2);
  });
});
