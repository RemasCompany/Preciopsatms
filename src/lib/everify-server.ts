import { z } from 'zod';
import type { Organization, User } from '@prisma/client';
import { HttpError, logActivity, type TenantDb } from './tenant';
import { hasFeature } from './plans';
import { localDate } from './timeclock';
import { STATUSES, createBy, isStatus } from './everify';

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** When an E-Verify company places someone, open a case to track (unless they already have an open one). */
export async function openCaseForPlacement(tdb: TenantDb, org: Organization, user: User, app: { id: string; candidateId: string; candidate: { name: string }; job: { startDate: Date | null } }) {
  if (!org.everifyEnabled || !hasFeature(org, 'onboarding')) return null;
  const openStatuses = Object.entries(STATUSES).filter(([, s]) => s.open).map(([k]) => k);
  if (await tdb.eVerifyCase.findFirst({ where: { candidateId: app.candidateId, status: { in: openStatuses } } })) return null;
  const today = localDate(new Date(), org.timezone);
  const start = app.job.startDate && ymd(app.job.startDate) > today ? ymd(app.job.startDate) : today;
  const c = await tdb.eVerifyCase.create({ data: { candidateId: app.candidateId, applicationId: app.id, startDate: new Date(`${start}T00:00:00Z`), dueDate: new Date(`${createBy(start)}T00:00:00Z`), createdById: user.id } as never });
  await logActivity(org.id, `E-Verify: create a case for ${app.candidate.name} by ${createBy(start)} (starts ${start})`, user.id);
  return c;
}

export const UpdateCase = z.object({
  status: z.string().refine(isStatus, 'Choose a status.').optional(),
  caseNumber: z.string().trim().regex(/^[\w-]{0,30}$/, 'Case numbers are letters and numbers only.').optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the first day of work.').optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function updateCase(tdb: TenantDb, org: Organization, user: User, id: string, b: z.infer<typeof UpdateCase>) {
  const c = await tdb.eVerifyCase.findFirst({ where: { id }, include: { candidate: { select: { name: true } } } });
  if (!c) throw new HttpError(404, 'That case was deleted.');
  if (b.status && b.status !== 'to_create' && !(b.caseNumber ?? c.caseNumber)) throw new HttpError(400, 'Enter the E-Verify case number first.');
  const data: Record<string, unknown> = {};
  if (b.caseNumber !== undefined) data.caseNumber = b.caseNumber || null;
  if (b.notes !== undefined) data.notes = b.notes || null;
  if (b.startDate) { data.startDate = new Date(`${b.startDate}T00:00:00Z`); data.dueDate = new Date(`${createBy(b.startDate)}T00:00:00Z`); }
  if (b.status) { data.status = b.status; data.closedAt = isStatus(b.status) && !STATUSES[b.status].open ? new Date() : null; }
  await tdb.eVerifyCase.updateMany({ where: { id: c.id }, data });
  if (b.status && b.status !== c.status) await logActivity(org.id, `E-Verify for ${c.candidate.name}: ${STATUSES[b.status as keyof typeof STATUSES].label}${b.caseNumber || c.caseNumber ? ` (case ${b.caseNumber || c.caseNumber})` : ''}`, user.id);
}

export async function createCase(tdb: TenantDb, org: Organization, user: User, candidateId: string, startDate: string) {
  const cand = await tdb.candidate.findFirst({ where: { id: candidateId }, select: { id: true, name: true } });
  if (!cand) throw new HttpError(404, 'That candidate was deleted.');
  const c = await tdb.eVerifyCase.create({ data: { candidateId: cand.id, startDate: new Date(`${startDate}T00:00:00Z`), dueDate: new Date(`${createBy(startDate)}T00:00:00Z`), createdById: user.id } as never });
  await logActivity(org.id, `E-Verify: create a case for ${cand.name} by ${createBy(startDate)}`, user.id);
  return c;
}
