import { z } from 'zod';
import type { Organization, User } from '@prisma/client';
import { HttpError, logActivity, tenantDb, type TenantDb } from './tenant';
import { audit } from './audit';

const digits = (s: string) => s.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
const first = (n: string) => n.split(' ')[0] || n;

export const ReferBody = z.object({
  name: z.string().trim().min(2, 'Enter your friend’s name.').max(120),
  email: z.string().trim().toLowerCase().max(200).refine((s) => !s || z.string().email().safeParse(s).success, 'Check the email address.').optional(),
  phone: z.string().trim().max(30).refine((s) => !s || digits(s).length === 10, 'Enter a 10-digit phone number.').optional(),
  jobId: z.string().optional(),
  note: z.string().trim().max(500).optional(),
}).refine((b) => b.email || b.phone, { message: 'Add a phone number or email so we can reach them.' });

/** Hours a referred worker has worked (approved or paid timesheets). */
async function hoursWorked(tdb: TenantDb, candidateIds: string[]) {
  if (!candidateIds.length) return new Map<string, number>();
  const ts = await tdb.timesheet.findMany({ where: { status: { in: ['APPROVED', 'PAID'] }, application: { candidateId: { in: candidateIds } } }, select: { regularHours: true, overtimeHours: true, application: { select: { candidateId: true } } } });
  const m = new Map<string, number>();
  for (const t of ts) m.set(t.application.candidateId, (m.get(t.application.candidateId) ?? 0) + Number(t.regularHours) + Number(t.overtimeHours));
  return m;
}

/**
 * A worker refers a friend from their private link. New people become candidates (source “Referral”), added to the
 * job they picked. Someone already in the database can't be referred (and we don't say who referred them first).
 */
export async function refer(org: Organization, referrer: { id: string; name: string }, body: unknown, byStaff?: User) {
  const r = ReferBody.safeParse(body ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Invalid input');
  const b = r.data, tdb = tenantDb(org.id);
  const me = await tdb.candidate.findFirst({ where: { id: referrer.id }, select: { email: true, phone: true } });
  if (!me) throw new HttpError(404, 'That worker was deleted.');
  if ((b.email && me.email?.toLowerCase() === b.email) || (b.phone && me.phone && digits(me.phone) === digits(b.phone))) throw new HttpError(400, 'That’s your own contact info — refer someone else!');
  const phoneMatches = b.phone ? (await tdb.candidate.findMany({ where: { phone: { not: null } }, select: { id: true, phone: true } })).filter((c) => digits(c.phone!) === digits(b.phone!)) : [];
  const existing = (b.email ? await tdb.candidate.findFirst({ where: { email: { equals: b.email, mode: 'insensitive' } } }) : null) ?? (phoneMatches[0] ? { id: phoneMatches[0].id } : null);
  if (existing) throw new HttpError(409, `Thanks! ${first(b.name)} is already in our system, so this one can’t count as a referral.`);
  const job = b.jobId ? await tdb.job.findFirst({ where: { id: b.jobId, status: 'OPEN' } }) : null;
  const cand = await tdb.candidate.create({ data: { name: b.name, email: b.email || null, phone: b.phone ? digits(b.phone) : null, source: 'Referral', summary: `Referred by ${referrer.name}${b.note ? `: ${b.note}` : ''}` } as never });
  if (job) await tdb.application.create({ data: { candidateId: cand.id, jobId: job.id, stage: 'APPLIED', maxStage: 'APPLIED' } as never });
  await tdb.referral.create({ data: { referrerId: referrer.id, candidateId: cand.id, jobId: job?.id ?? null, note: b.note || null, bonus: org.referralBonus, minHours: org.referralBonus ? org.referralMinHours : null } as never });
  await logActivity(org.id, `${referrer.name} referred ${b.name}${job ? ` for ${job.title}` : ''}`, byStaff?.id);
  return { candidateId: cand.id, message: `Thanks for referring ${first(b.name)}! We’ll reach out to them${org.referralBonus ? ' — and let you know when your bonus is on its way' : ''}.` };
}

export type ReferralRow = Awaited<ReturnType<typeof referralRows>>[number];
/** Staff view: every referral with hours worked and whether the bonus is due. */
export async function referralRows(tdb: TenantDb) {
  const refs = await tdb.referral.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
  const ids = [...new Set(refs.flatMap((r) => [r.referrerId, r.candidateId]))];
  const people = new Map((await tdb.candidate.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, status: true } })).map((c) => [c.id, c]));
  const hours = await hoursWorked(tdb, refs.map((r) => r.candidateId));
  return refs.map((r) => {
    const h = Math.round((hours.get(r.candidateId) ?? 0) * 100) / 100;
    const due = r.status === 'submitted' && r.bonus != null && h >= (r.minHours ?? 0);
    return { id: r.id, referrer: people.get(r.referrerId)?.name ?? 'Former worker', referrerId: r.referrerId, friend: people.get(r.candidateId)?.name ?? 'Deleted', friendId: r.candidateId, friendStatus: people.get(r.candidateId)?.status ?? null,
      createdAt: r.createdAt.toISOString(), hours: h, minHours: r.minHours, bonus: r.bonus == null ? null : Number(r.bonus), status: r.status, due, paidAt: r.paidAt?.toISOString() ?? null, ineligibleReason: r.ineligibleReason };
  });
}

/** Worker view: their referrals (friend's first name only) and progress toward the bonus. */
export async function workerReferrals(org: Organization, candidateId: string) {
  const tdb = tenantDb(org.id);
  const rows = (await referralRows(tdb)).filter((r) => r.referrerId === candidateId);
  const jobs = await tdb.job.findMany({ where: { status: 'OPEN', publish: true }, select: { id: true, title: true, location: true }, orderBy: { title: 'asc' }, take: 50 });
  return {
    bonus: org.referralBonus == null ? null : Number(org.referralBonus), minHours: org.referralMinHours,
    jobs: jobs.map((j) => ({ id: j.id, label: [j.title, j.location].filter(Boolean).join(' — ') })),
    mine: rows.map((r) => ({ id: r.id, name: first(r.friend), status: r.status === 'paid' ? 'Bonus paid' : r.status === 'ineligible' ? 'Not eligible' : r.due ? 'Bonus on its way' : r.hours > 0 ? `Working — ${Math.floor(r.hours)}${r.minHours ? ` of ${r.minHours}` : ''} hours` : 'Received' })),
  };
}

export const Decide = z.discriminatedUnion('action', [
  z.object({ action: z.literal('paid') }),
  z.object({ action: z.literal('ineligible'), reason: z.string().trim().min(3, 'Say why.').max(300) }),
  z.object({ action: z.literal('reopen') }),
]);

export async function decide(tdb: TenantDb, org: Organization, user: User, id: string, b: z.infer<typeof Decide>) {
  const rows = await referralRows(tdb);
  const r = rows.find((x) => x.id === id);
  if (!r) throw new HttpError(404, 'That referral was deleted.');
  if (b.action === 'paid') {
    if (r.status === 'paid') throw new HttpError(409, 'Already marked paid.');
    if (!r.due) throw new HttpError(409, r.bonus == null ? 'There’s no bonus on this referral.' : `${r.friend} has worked ${r.hours} of ${r.minHours} hours — the bonus isn’t due yet.`);
    await tdb.referral.updateMany({ where: { id }, data: { status: 'paid', paidAt: new Date(), paidById: user.id } });
    await audit(org.id, user, 'referral.paid', `Marked the $${r.bonus} referral bonus paid to ${r.referrer} (referred ${r.friend})`, { targetType: 'referral', targetId: id });
  } else if (b.action === 'ineligible') {
    await tdb.referral.updateMany({ where: { id }, data: { status: 'ineligible', ineligibleReason: b.reason } });
    await logActivity(org.id, `Referral of ${r.friend} by ${r.referrer} marked not eligible: ${b.reason}`, user.id);
  } else {
    await tdb.referral.updateMany({ where: { id }, data: { status: 'submitted', ineligibleReason: null, paidAt: null, paidById: null } });
  }
}
