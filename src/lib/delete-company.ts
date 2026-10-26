// Deleting a company (owner only): stops billing, disconnects outside services, removes stored files, then deletes
// the company and everything in it. People who belonged only to this company lose their login too.
// Records other services keep for the company (Check payroll history, Checkr reports, Stripe invoices) stay there.
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Organization, User } from '@prisma/client';
import { db } from './db';
import { HttpError } from './tenant';
import { stripe, stripeEnabled } from './stripe';
import { removeFile } from './storage';
import { checkSecondStep } from './two-step';
import { disconnect as disconnectCheckr } from './checkr';
import { turnOff as turnOffSso } from './sso';
import { disconnect as disconnectBooks } from './accounting';
import { captureError } from './monitoring';

export const DeleteBody = z.object({
  confirmName: z.string().trim().min(1, 'Type your company’s name to confirm.').max(200),
  password: z.string().min(1, 'Enter your password.').max(200),
  code: z.string().trim().max(20).optional(),
});

const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

/** Checks it's really the owner (name typed, password, and their two-step code if they use one). */
export async function confirmOwner(org: Organization, user: User, b: z.infer<typeof DeleteBody>) {
  if (!sameName(b.confirmName, org.name)) throw new HttpError(400, `Type the company name exactly as shown (“${org.name}”) to confirm.`);
  if (!(await bcrypt.compare(b.password, user.passwordHash))) throw new HttpError(403, 'That password isn’t right.');
  if (user.totpEnabledAt) {
    if (!b.code) throw new HttpError(400, 'Enter the code from your authenticator app (or a recovery code).');
    if (!(await checkSecondStep(user, b.code))) throw new HttpError(403, 'That two-step code didn’t work. Enter the newest one from your app.');
  }
}

export async function deleteCompany(org: Organization, user: User) {
  // 1. Stop billing first: a company that can't be charged anymore must not keep a live subscription.
  if (org.stripeSubscriptionId && stripeEnabled()) {
    try { await stripe.subscriptions.cancel(org.stripeSubscriptionId); }
    catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'resource_missing') throw new HttpError(502, 'We couldn’t cancel your subscription with Stripe, so nothing was deleted. Try again in a minute.');
    }
  }
  // 2. Outside connections, best effort: the data here goes either way.
  for (const [what, step] of [['Checkr', () => disconnectCheckr(org, user)], ['single sign-on', () => turnOffSso(org, user)],
    ['QuickBooks', () => disconnectBooks(org, user, 'quickbooks')], ['Xero', () => disconnectBooks(org, user, 'xero')]] as const) {
    await step().catch((e) => captureError(e, { route: 'delete-company', method: what }));
  }
  // 3. Uploaded files (resumes, signed documents, photos).
  const files = await db.storedFile.findMany({ where: { organizationId: org.id }, select: { key: true } });
  for (const f of files) await removeFile(f.key).catch((e) => captureError(e, { route: 'delete-company', method: 'file' }));
  // 4. The company and everything in it (every company table cascades from Organization), then logins no other company uses.
  const members = await db.membership.findMany({ where: { organizationId: org.id }, select: { userId: true } });
  await db.organization.delete({ where: { id: org.id } });
  const orphans = await db.user.findMany({ where: { id: { in: members.map((m) => m.userId) }, memberships: { none: {} } }, select: { id: true } });
  await db.user.deleteMany({ where: { id: { in: orphans.map((u) => u.id) } } });
  // A line in the server log is the only trace: who asked, when, how much went.
  console.info(`[delete-company] ${org.id} (${org.slug}) deleted by user ${user.id}: ${files.length} files, ${members.length} members, ${orphans.length} logins removed`);
  return { files: files.length, logins: orphans.length };
}
