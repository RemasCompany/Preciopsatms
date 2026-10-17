// Helpers shared by the two-step sign-in routes.
import { db } from './db';
import { HttpError } from './tenant';
import { audit, type AuditAction } from './audit';
import { limited } from './rate-limit';

/** The two-step functions throw plain errors with messages meant for the user. */
export const friendly = async <T>(p: Promise<T>) => { try { return await p; } catch (e) { throw new HttpError(400, (e as Error).message); } };

/** Logs a change to someone's own sign-in in every company they belong to: each one's admins should see it. */
export async function logEverywhere(user: { id: string; email: string }, action: AuditAction, summary: string, req: Request) {
  const ms = await db.membership.findMany({ where: { userId: user.id }, select: { organizationId: true } });
  for (const m of ms) await audit(m.organizationId, user, action, summary, { targetType: 'user', targetId: user.id, req });
}

/** Codes are only six digits, so guesses are limited here as they are at sign-in. */
export async function throttle(userId: string) {
  if (await limited('two-step', userId, 10, 15 * 60e3)) throw new HttpError(429, 'Too many tries. Wait 15 minutes and try again.');
}
