// Two-step sign-in for team accounts: an authenticator-app code after the password, with one-time recovery codes for
// a lost phone. The secret is sealed at rest; recovery codes are stored as hashes and shown once.
import QRCode from 'qrcode';
import { db } from './db';
import { open, seal } from './secret-box';
import { hashRecovery, looksLikeRecovery, newRecoveryCodes, newSecret, otpauthUrl, groupSecret, verifyCode } from './totp';

export const ISSUER = 'Preciops ATMS';
export const TWO_STEP_REQUIRED = 'TWO_STEP_REQUIRED';
export const TWO_STEP_INVALID = 'TWO_STEP_INVALID';

type UserRow = { id: string; email: string; totpSecret: string | null; totpEnabledAt: Date | null; totpLastStep: number | null; recoveryCodes: string[] };

export const twoStepOn = (u: { totpEnabledAt: Date | null }) => !!u.totpEnabledAt;

export async function status(userId: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { totpEnabledAt: true, recoveryCodes: true } });
  return { enabled: !!u.totpEnabledAt, enabledAt: u.totpEnabledAt?.toISOString() ?? null, recoveryLeft: u.totpEnabledAt ? u.recoveryCodes.length : 0 };
}

/**
 * Starts setup, or a move to a new phone: a fresh secret and its QR code. Nothing is saved yet; the secret travels
 * sealed (bound to this user, for 15 minutes) until the first code from the app confirms it.
 */
export async function beginSetup(user: { id: string; email: string }) {
  const secret = newSecret();
  const url = otpauthUrl(ISSUER, user.email, secret);
  return { qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }), secret: groupSecret(secret), url, pending: seal(JSON.stringify({ s: secret, u: user.id, exp: Date.now() + 15 * 60e3 })) };
}

/**
 * Confirms with the first code from the app; returns new recovery codes (the only time they're shown). Moving an
 * existing setup to a new phone also takes a code from the old one, or a recovery code, so a borrowed session can't.
 */
export async function confirmSetup(userId: string, pending: string, code: string, proof?: string, now = Date.now()) {
  let p: { s: string; u: string; exp: number };
  try { p = JSON.parse(open(pending)); } catch { throw new Error('Start setup again: scan the new QR code first.'); }
  if (p.u !== userId || p.exp < now) throw new Error('That QR code has expired. Start again and scan the new one.');
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (u.totpEnabledAt) {
    if (!proof?.trim()) throw new Error('Enter a code from your old phone, or a recovery code, to move two-step sign-in.');
    if (!(await checkSecondStep(u, proof, now))) throw new Error('The code from your old phone (or recovery code) didn’t work.');
  }
  const step = verifyCode(p.s, code, now);
  if (step === null) throw new Error('That code didn’t match. Check your phone’s time is set automatically and enter the newest code.');
  const codes = newRecoveryCodes();
  await db.user.update({ where: { id: userId }, data: { totpSecret: seal(p.s), totpEnabledAt: new Date(now), totpLastStep: step, recoveryCodes: codes.map(hashRecovery) } });
  return codes;
}

/**
 * Checks the second step at sign-in: a current app code, or a recovery code (used up once it works).
 * Each is claimed with a conditional update, so two sign-ins racing with the same code can't both succeed.
 */
export async function checkSecondStep(u: UserRow, code: string, now = Date.now()): Promise<'code' | 'recovery' | null> {
  if (!u.totpEnabledAt || !u.totpSecret) return 'code';
  if (looksLikeRecovery(code)) {
    const h = hashRecovery(code);
    if (!u.recoveryCodes.includes(h)) return null;
    const r = await db.user.updateMany({ where: { id: u.id, recoveryCodes: { has: h } }, data: { recoveryCodes: u.recoveryCodes.filter((x) => x !== h) } });
    return r.count ? 'recovery' : null;
  }
  const step = verifyCode(open(u.totpSecret), code, now, u.totpLastStep);
  if (step === null) return null;
  const r = await db.user.updateMany({ where: { id: u.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
  return r.count ? 'code' : null;
}

/** Proves it's really them before turning it off or making new recovery codes. */
async function prove(userId: string, code: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!u.totpEnabledAt) throw new Error('Two-step sign-in isn’t on.');
  if (!(await checkSecondStep(u, code))) throw new Error('That code didn’t work. Enter the newest code from your app, or a recovery code.');
}

export async function regenerateRecovery(userId: string, code: string) {
  await prove(userId, code);
  const codes = newRecoveryCodes();
  await db.user.update({ where: { id: userId }, data: { recoveryCodes: codes.map(hashRecovery) } });
  return codes;
}

export const clear = { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] };

export async function disable(userId: string, code: string) {
  await prove(userId, code);
  await db.user.update({ where: { id: userId }, data: clear });
}
