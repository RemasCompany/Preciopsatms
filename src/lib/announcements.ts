import { z } from 'zod';
import type { Organization, User } from '@prisma/client';
import { HttpError, logActivity, tenantDb, type TenantDb } from './tenant';
import { assignmentWhere } from './schedule-server';
import { INLINE_MAX, queueBulk, sendBulk, summary, type SendInput } from './bulk-messaging';

/**
 * Announcements: a note to the whole team or one location. Everyone it's for sees it on their own page (the worker and
 * employee app); "also email it" sends each person their own copy through the usual logged, opt-out-honoring send.
 * The team = active employees and workers currently placed on an assignment.
 */
export const AnnouncementBody = z.object({
  title: z.string().trim().min(2, 'Give the announcement a title.').max(120, 'Keep the title under 120 characters.'),
  body: z.string().trim().min(2, 'Write the announcement.').max(5000, 'Keep it under 5,000 characters.'),
  branchId: z.string().min(1).nullish(),
  email: z.boolean().optional(),
});

/** How long an announcement stays on people's pages. */
export const SHOW_DAYS = 45;

/** Everyone an announcement reaches: their person records (candidate ids). */
export async function audience(tdb: TenantDb, branchId: string | null) {
  const [employees, placed] = await Promise.all([
    tdb.employee.findMany({ where: { status: { not: 'TERMINATED' }, ...(branchId ? { OR: [{ branchId }, { branchId: null, candidate: { branchId } }] } : {}) }, select: { candidateId: true } }),
    tdb.application.findMany({ where: { ...assignmentWhere, ...(branchId ? { candidate: { branchId } } : {}) }, select: { candidateId: true } }),
  ]);
  return [...new Set([...employees.map((e) => e.candidateId), ...placed.map((a) => a.candidateId)])];
}

export async function postAnnouncement(org: Organization, user: User, raw: unknown) {
  const p = AnnouncementBody.safeParse(raw);
  if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? 'Invalid input');
  const b = p.data, tdb = tenantDb(org.id);
  const branch = b.branchId ? await tdb.branch.findFirst({ where: { id: b.branchId } }) : null;
  if (b.branchId && !branch) throw new HttpError(400, 'Choose one of your locations.');
  const people = await audience(tdb, branch?.id ?? null);
  const a = await tdb.announcement.create({ data: { title: b.title, body: b.body, branchId: branch?.id ?? null, createdById: user.id } as never });
  await logActivity(org.id, `Announcement “${b.title}” to ${branch ? branch.name : 'everyone'}`, user.id);
  if (!b.email || !people.length) return { id: a.id, reach: people.length, emailed: null as null | { sent: number; skipped: number; failed: number } | { queued: true; total: number } };
  const send: SendInput = { channel: 'email', recipientType: 'candidate', recipientIds: people, subject: `${org.shortName ?? org.name}: ${b.title}`, body: b.body };
  if (people.length > INLINE_MAX) {
    await queueBulk(org.id, user.id, send);
    await tdb.announcement.updateMany({ where: { id: a.id }, data: { emailed: people.length } });
    return { id: a.id, reach: people.length, emailed: { queued: true as const, total: people.length } };
  }
  const t = await sendBulk(org, user, send);
  await logActivity(org.id, summary(send, t), user.id);
  await tdb.announcement.updateMany({ where: { id: a.id }, data: { emailed: t.sent } });
  return { id: a.id, reach: people.length, emailed: t };
}

/** What one person sees on their page: announcements for everyone or for their location, newest first. */
export async function workerAnnouncements(orgId: string, candidateId: string, now = new Date()) {
  const tdb = tenantDb(orgId);
  const [c, e] = await Promise.all([
    tdb.candidate.findFirst({ where: { id: candidateId }, select: { branchId: true } }),
    tdb.employee.findFirst({ where: { candidateId }, select: { branchId: true } }),
  ]);
  const branches = [e?.branchId, c?.branchId].filter((x): x is string => !!x);
  const rows = await tdb.announcement.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - SHOW_DAYS * 864e5) }, OR: [{ branchId: null }, ...(branches.length ? [{ branchId: { in: branches } }] : [])] },
    orderBy: { createdAt: 'desc' }, take: 10, include: { branch: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, title: r.title, body: r.body, date: r.createdAt.toISOString().slice(0, 10), location: r.branch?.name ?? null }));
}
