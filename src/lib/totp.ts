// Authenticator-app codes (TOTP, RFC 6238: HMAC-SHA1, 6 digits, 30-second steps), the same kind Google
// Authenticator, Microsoft Authenticator, 1Password and Authy make. Plus one-time recovery codes. Pure (tested).
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;

export function base32Encode(buf: Buffer) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string) {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Not a base32 secret');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 as authenticator apps expect. */
export const newSecret = () => base32Encode(randomBytes(20));

export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

export function codeAt(secret: string, step: number) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

/**
 * The step a code matches, allowing one step either side for clock drift; null if it doesn't match or that step
 * (or a later one) was already used, so a code seen over someone's shoulder can't be used again.
 */
export function verifyCode(secret: string, code: string, now = Date.now(), lastStep: number | null = null) {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const at = stepAt(now);
  for (const step of [at, at - 1, at + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(codeAt(secret, step)), Buffer.from(c))) return step;
  }
  return null;
}

/** The link authenticator apps read from the QR code. */
export const otpauthUrl = (issuer: string, account: string, secret: string) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;

/** The secret in groups of four, for typing in by hand. */
export const groupSecret = (secret: string) => secret.match(/.{1,4}/g)!.join(' ');

// Recovery codes: no 0/O, 1/I/L, so they're easy to read off paper.
const RC = 'abcdefghjkmnpqrstuvwxyz23456789';
export const RECOVERY_COUNT = 10;
export const newRecoveryCodes = () => Array.from({ length: RECOVERY_COUNT }, () => {
  const s = Array.from({ length: 8 }, () => RC[randomInt(RC.length)]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
});
export const normalizeRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');
export const hashRecovery = (code: string) => createHash('sha256').update(normalizeRecovery(code)).digest('hex');
export const looksLikeRecovery = (code: string) => normalizeRecovery(code).length === 8 && !/^\d+$/.test(normalizeRecovery(code));
