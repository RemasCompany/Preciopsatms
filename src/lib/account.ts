import type { User } from '@prisma/client';
import { db } from './db';
import { newToken, sha256 } from './tokens';
import { sendEmail } from './email';

const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';
const TTL = { reset: 60 * 60e3, verify: 7 * 864e5 } as const;
export type TokenKind = keyof typeof TTL;

/** A fresh one-time link for a user; earlier unused links of the same kind stop working. */
export async function issueToken(userId: string, kind: TokenKind) {
  await db.authToken.updateMany({ where: { userId, kind, usedAt: null }, data: { usedAt: new Date() } });
  const token = newToken();
  await db.authToken.create({ data: { userId, kind, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL[kind]) } });
  return token;
}

/** Checks a link without using it up. */
export async function peekToken(raw: string, kind: TokenKind) {
  if (!raw || raw.length > 100) return null;
  const t = await db.authToken.findUnique({ where: { tokenHash: sha256(raw) }, include: { user: true } });
  if (!t || t.kind !== kind || t.usedAt || t.expiresAt < new Date()) return null;
  return t;
}

/** Uses up a link (once). Returns its user, or null if it was invalid, expired or already used. */
export async function consumeToken(raw: string, kind: TokenKind) {
  const t = await peekToken(raw, kind);
  if (!t) return null;
  const { count } = await db.authToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
  return count ? t.user : null;
}

export async function sendVerification(user: Pick<User, 'id' | 'email' | 'name'>) {
  const token = await issueToken(user.id, 'verify');
  await sendEmail({ to: user.email, subject: 'Confirm your email for Preciops',
    text: `Hi ${user.name?.split(' ')[0] ?? 'there'},\n\nPlease confirm this is your email address:\n\n${appUrl()}/verify/${token}\n\nThe link works for 7 days. If you didn’t create a Preciops account, you can ignore this email.\n\nPreciops` });
}

export async function sendPasswordReset(user: Pick<User, 'id' | 'email' | 'name'>) {
  const token = await issueToken(user.id, 'reset');
  await sendEmail({ to: user.email, subject: 'Reset your Preciops password',
    text: `Hi ${user.name?.split(' ')[0] ?? 'there'},\n\nSomeone (hopefully you) asked to reset the password for this Preciops account. Choose a new password here:\n\n${appUrl()}/reset/${token}\n\nThe link works for 1 hour and only once. If you didn’t ask for this, you can ignore this email — your password won’t change.\n\nPreciops` });
}
