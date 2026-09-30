import { z } from 'zod';
import type { Organization, User } from '@prisma/client';
import { HttpError, logActivity, type TenantDb } from './tenant';
import { audit } from './audit';

/**
 * Do-not-return: a worker a client doesn't want back (or nobody should place again). Entries are lifted, never deleted,
 * so there's a record of who decided what and why. They block adding to that client's jobs, placing and scheduling.
 */
export async function barredFrom(tdb: TenantDb, candidateId: string, clientId: string | null) {
  return tdb.doNotReturn.findFirst({ where: { candidateId, liftedAt: null, OR: [{ clientId: null }, ...(clientId ? [{ clientId }] : [])] }, orderBy: { createdAt: 'desc' } });
}

/** Throws a friendly 409 when the worker is on the client's (or the company-wide) do-not-return list. */
export async function assertNotBarred(tdb: TenantDb, candidate: { id: string; name: string }, clientId: string | null, clientName?: string | null) {
  const d = await barredFrom(tdb, candidate.id, clientId);
  if (d) throw new HttpError(409, d.clientId
    ? `${candidate.name} is on ${clientName ?? 'this client'}’s do-not-return list (${d.reason}). An admin can lift it from the candidate’s record.`
    : `${candidate.name} is on the company-wide do-not-return list (${d.reason}). An admin can lift it from the candidate’s record.`);
}

/** When a client says they wouldn't have someone back, honor it without waiting for a recruiter. */
export async function addFromClientFeedback(tdb: TenantDb, orgId: string, candidate: { id: string; name: string }, client: { id: string; name: string }, by: string, comment?: string | null) {
  if (await tdb.doNotReturn.findFirst({ where: { candidateId: candidate.id, clientId: client.id, liftedAt: null } })) return;
  await tdb.doNotReturn.create({ data: { candidateId: candidate.id, clientId: client.id, source: 'client feedback', reason: `${by} said they wouldn’t have them back${comment ? `: “${comment.slice(0, 200)}”` : ''}` } as never });
  await logActivity(orgId, `${candidate.name} added to ${client.name}’s do-not-return list (client feedback from ${by})`);
}

export const AddBody = z.object({
  candidateId: z.string().min(1),
  clientId: z.string().nullable(),
  reason: z.string().trim().min(3, 'Say why — it helps whoever sees this later.').max(500, 'Keep it under 500 characters.'),
});

export async function addDnr(tdb: TenantDb, org: Organization, user: User, b: z.infer<typeof AddBody>) {
  const c = await tdb.candidate.findFirst({ where: { id: b.candidateId }, select: { id: true, name: true } });
  if (!c) throw new HttpError(404, 'That candidate was deleted.');
  const client = b.clientId ? await tdb.client.findFirst({ where: { id: b.clientId }, select: { id: true, name: true } }) : null;
  if (b.clientId && !client) throw new HttpError(404, 'That client was deleted.');
  if (await tdb.doNotReturn.findFirst({ where: { candidateId: c.id, clientId: b.clientId, liftedAt: null } })) throw new HttpError(409, 'They’re already on that list.');
  const d = await tdb.doNotReturn.create({ data: { candidateId: c.id, clientId: b.clientId, reason: b.reason, createdById: user.id } as never });
  const where = client ? `${client.name}’s` : 'the company-wide';
  await logActivity(org.id, `${c.name} added to ${where} do-not-return list: ${b.reason}`, user.id);
  await audit(org.id, user, 'dnr.add', `Added ${c.name} to ${where} do-not-return list: ${b.reason}`, { targetType: 'candidate', targetId: c.id });
  return d;
}

export async function liftDnr(tdb: TenantDb, org: Organization, user: User, id: string, reason: string) {
  const d = await tdb.doNotReturn.findFirst({ where: { id, liftedAt: null }, include: { candidate: { select: { id: true, name: true } } } });
  if (!d) throw new HttpError(404, 'That entry was already lifted.');
  await tdb.doNotReturn.updateMany({ where: { id: d.id }, data: { liftedAt: new Date(), liftedById: user.id, liftReason: reason } });
  const client = d.clientId ? await tdb.client.findFirst({ where: { id: d.clientId }, select: { name: true } }) : null;
  const text = `Lifted ${d.candidate.name}’s do-not-return for ${client?.name ?? 'all clients'}: ${reason}`;
  await logActivity(org.id, text, user.id);
  await audit(org.id, user, 'dnr.lift', text, { targetType: 'candidate', targetId: d.candidate.id });
}
