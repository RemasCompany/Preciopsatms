import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Encryption for third-party tokens at rest (AES-256-GCM). The key comes from INTEGRATIONS_KEY, falling back to
 * NEXTAUTH_SECRET so it works out of the box; set INTEGRATIONS_KEY in production so rotating one doesn't break the other.
 */
const key = () => {
  const k = process.env.INTEGRATIONS_KEY || process.env.NEXTAUTH_SECRET;
  if (!k) throw new Error('Set INTEGRATIONS_KEY (or NEXTAUTH_SECRET) to store integration tokens.');
  return createHash('sha256').update(k).digest();
};

export function seal(plain: string) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}

export function open(sealed: string) {
  const [v, iv, tag, enc] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('Unreadable sealed value');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
}

/** A short-lived signed value (e.g. OAuth state) that can't be forged or replayed after it expires. */
export function signState(data: Record<string, string>, ttlMs = 10 * 60e3) {
  const body = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + ttlMs, n: randomBytes(8).toString('hex') })).toString('base64url');
  return `${body}.${createHmac('sha256', key()).update(body).digest('base64url')}`;
}

export function readState(state: string | null): Record<string, string> | null {
  if (!state) return null;
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(createHmac('sha256', key()).update(body).digest('base64url')), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const d = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  return typeof d.exp === 'number' && d.exp > Date.now() ? d : null;
}
