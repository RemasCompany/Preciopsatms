import { z } from 'zod';
import type { JobChange, Organization, PayType, Role, User } from '@prisma/client';
import { db } from './db';
import { HttpError, logActivity, tenantDb, type TenantDb } from './tenant';
import { audit } from './audit';
import { sendEmail } from './email';
import { localDate } from './timeclock';
import { deliver } from './schedule-server';
import { money } from './people-shared';
import { addCompensation, checkRefs, isAdmin } from './people';

/**
 * Promotions, demotions, lateral moves and pay changes, as a process:
 *  1. The employee's manager (anyone above them in the reporting line who signs in to Preciops) or HR proposes it, with
 *     the reason and an effective date.
 *  2. HR (owners and admins) approves or declines. HR's own changes, and managers' changes when the company turns
 *     approval off, are approved straight away.
 *  3. On the effective date the title and pay go into pay history and the department, manager and location change.
 *     The employee gets a written notice when it's approved (before the date), and the person who asked hears back.
 * Pay figures are for owners and admins; managers can propose a new rate but never see current pay.
 */
type Ctx = { tdb: TenantDb; org: Organization; user: User; role: Role };
export const KINDS = { PROMOTION: 'Promotion', DEMOTION: 'Demotion', LATERAL: 'Lateral move or transfer', PAY: 'Pay change' } as const;
export type Kind = keyof typeof KINDS;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';
// Blank means “no change” (the form sends empty strings for untouched selects).
const id = z.string().trim().max(40, 'That choice isn’t valid.');

export const ProposeBody = z.object({
  kind: z.enum(['PROMOTION', 'DEMOTION', 'LATERAL', 'PAY'], { errorMap: () => ({ message: 'Choose promotion, demotion, lateral move or pay change.' }) }),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the effective date.'),
  toTitle: z.string().trim().max(120).nullish().transform((v) => v || null),
  toDepartmentId: id.nullish().transform((v) => v || null),
  toManagerId: id.nullish().transform((v) => v || null),
  toBranchId: id.nullish().transform((v) => v || null),
  toPayType: z.enum(['HOURLY', 'SALARY']).nullish().transform((v) => v || null),
  toPayRate: z.coerce.number().min(0, 'Pay can’t be negative.').max(10_000_000, 'That pay looks too high.').nullish().transform((v) => (v === undefined || v === null || Number.isNaN(v) ? null : v)),
  reason: z.string().trim().min(3, 'Give the reason (for example: took over the night shift team; performance review).').max(1000),
  notifyEmployee: z.boolean().default(true),
});
export const DecideBody = z.object({
  action: z.enum(['approve', 'decline', 'cancel']),
  note: z.string().trim().max(500).optional(),
  toPayType: z.enum(['HOURLY', 'SALARY']).optional(),
  toPayRate: z.coerce.number().min(0).max(10_000_000).optional(),
});

/** Email addresses a person signs in with, from their employee record. */
const emailsOf = (e: { workEmail: string | null; candidate: { email: string | null } }) => [e.workEmail, e.candidate.email].filter((x): x is string => !!x).map((x) => x.toLowerCase());

/** Is this user the employee's manager, or their manager's manager, and so on? */
export async function managesEmployee(tdb: TenantDb, user: Pick<User, 'email'>, employeeId: string) {
  const me = user.email.toLowerCase();
  let at = (await tdb.employee.findFirst({ where: { id: employeeId }, select: { managerId: true } }))?.managerId ?? null;
  for (let hops = 0; at && hops < 25; hops++) {
    const m = await tdb.employee.findFirst({ where: { id: at }, select: { managerId: true, status: true, workEmail: true, candidate: { select: { email: true } } } });
    if (!m) return false;
    if (m.status !== 'TERMINATED' && emailsOf(m).includes(me)) return true;
    at = m.managerId;
  }
  return false;
}

/** Can this person propose a job change for this employee? HR always; managers for people below them; never yourself. */
export async function mayPropose(ctx: Pick<Ctx, 'tdb' | 'role' | 'user'>, employee: { id: string; workEmail: string | null; candidate: { email: string | null } }) {
  if (ctx.role === 'VIEWER') return false;
  if (ctx.role !== 'OWNER' && emailsOf(employee).includes(ctx.user.email.toLowerCase())) return false;
  return isAdmin(ctx.role) || managesEmployee(ctx.tdb, ctx.user, employee.id);
}

const include = { candidate: { select: { name: true, email: true, phone: true, emailOptOut: true, smsOptOut: true } } } as const;

export async function propose(ctx: Ctx, employeeId: string, raw: unknown) {
  const p = ProposeBody.safeParse(raw);
  if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? 'Invalid input');
  const b = p.data;
  const { tdb, org, user, role } = ctx;
  const e = await tdb.employee.findFirst({ where: { id: employeeId }, include });
  if (!e) throw new HttpError(404, 'That employee was deleted.');
  if (e.status === 'TERMINATED') throw new HttpError(409, 'Their employment has ended.');
  if (!(await mayPropose(ctx, { ...e, candidate: e.candidate }))) throw new HttpError(403, ctx.role !== 'OWNER' && emailsOf({ ...e, candidate: e.candidate }).includes(user.email.toLowerCase()) ? 'You can’t change your own job. Ask your manager or HR.' : 'Only HR or someone above this person in the reporting line can change their job.');

  const admin = isAdmin(role);
  // Managers don't see current pay, so a pay type only counts when they also give a rate.
  const toPayType = b.toPayRate !== null ? (b.toPayType ?? e.payType) : null;
  const changes = {
    toTitle: b.toTitle && b.toTitle !== e.title ? b.toTitle : null,
    toDepartmentId: b.toDepartmentId && b.toDepartmentId !== e.departmentId ? b.toDepartmentId : null,
    toManagerId: b.toManagerId && b.toManagerId !== e.managerId ? b.toManagerId : null,
    toBranchId: b.toBranchId && b.toBranchId !== e.branchId ? b.toBranchId : null,
    toPayType, toPayRate: b.toPayRate,
  };
  const payChanges = changes.toPayRate !== null && (changes.toPayRate !== Number(e.payRate) || toPayType !== e.payType);
  const roleChanges = !!(changes.toTitle || changes.toDepartmentId || changes.toManagerId || changes.toBranchId);
  if (!payChanges && !roleChanges) throw new HttpError(400, 'Nothing changes: enter a new title, department, manager, location or pay.');
  if (b.kind === 'PAY' && !payChanges) throw new HttpError(400, 'A pay change needs the new pay.');
  if (b.kind === 'LATERAL' && !roleChanges) throw new HttpError(400, 'A lateral move changes the title, department, manager or location. For pay alone, choose “Pay change”.');
  if ((b.kind === 'PROMOTION' || b.kind === 'DEMOTION') && !changes.toTitle && !payChanges) throw new HttpError(400, `A ${b.kind === 'PROMOTION' ? 'promotion' : 'demotion'} needs a new title or new pay.`);
  if (b.kind === 'PROMOTION' && payChanges && toPayType === e.payType && changes.toPayRate! < Number(e.payRate)) throw new HttpError(400, admin ? 'That lowers their pay. Choose “Demotion” or “Pay change” instead.' : 'Check the new pay: it looks lower than their current pay. HR can help.');
  await checkRefs(tdb, { departmentId: changes.toDepartmentId, branchId: changes.toBranchId, managerId: changes.toManagerId }, e.id);

  const today = localDate(new Date(), org.timezone);
  if (b.effectiveDate < ymd(new Date(Date.now() - 90 * 864e5))) throw new HttpError(400, 'The effective date is more than 90 days ago. Correct past pay through payroll instead.');
  // A pay cut can't reach back over time already worked.
  if (payChanges && toPayType === e.payType && changes.toPayRate! < Number(e.payRate) && b.effectiveDate < today) throw new HttpError(400, 'A pay decrease can’t be backdated: it can only start today or later, and many states require written notice before it starts.');
  if (await tdb.jobChange.findFirst({ where: { employeeId: e.id, status: 'PENDING' } })) throw new HttpError(409, 'There’s already a job change waiting for approval for this person. Approve, decline or cancel it first.');

  const autoApprove = admin || !org.jobChangeApproval;
  const c = await tdb.jobChange.create({ data: {
    employeeId: e.id, kind: b.kind, effectiveDate: day(b.effectiveDate), reason: b.reason, notifyEmployee: b.notifyEmployee,
    fromTitle: e.title, fromDepartmentId: e.departmentId, fromManagerId: e.managerId, fromBranchId: e.branchId, fromPayType: e.payType, fromPayRate: e.payRate,
    ...changes, requestedById: user.id, requestedByName: user.name ?? user.email, status: 'PENDING',
  } as never });
  await audit(org.id, user, 'employee.job_change', `Proposed a ${KINDS[b.kind].toLowerCase()} for ${e.candidate.name}${changes.toTitle ? ` to ${changes.toTitle}` : ''}, effective ${b.effectiveDate}`, { targetType: 'Employee', targetId: e.id });
  if (autoApprove) return { ...(await approve(ctx, c.id, {})), pending: false };
  await logActivity(org.id, `${user.name ?? user.email} proposed a ${KINDS[b.kind].toLowerCase()} for ${e.candidate.name} (waiting for approval)`, user.id);
  await tellAdmins(org, c, e.candidate.name, user);
  return { ok: true, pending: true, message: `Sent to HR for approval. You’ll get an email when it’s decided.` };
}

async function tellAdmins(org: Organization, c: JobChange, name: string, by: User) {
  const admins = await db.membership.findMany({ where: { organizationId: org.id, role: { in: ['OWNER', 'ADMIN'] } }, select: { user: { select: { email: true } } } });
  const tdb = tenantDb(org.id);
  const subject = `Approval needed: ${KINDS[c.kind as Kind].toLowerCase()} for ${name}`;
  const text = [`${by.name ?? by.email} proposed a ${KINDS[c.kind as Kind].toLowerCase()} for ${name}, effective ${ymd(c.effectiveDate)}.`, '', `Reason: ${c.reason}`, '', `Review it: ${appUrl()}/app/employees?changes=1`].join('\n');
  for (const { user } of admins) {
    let status = 'sent', providerId: string | null = null, error: string | null = null;
    try { providerId = (await sendEmail({ to: user.email, subject, text, fromName: org.shortName ?? org.name })).id; } catch (e) { status = 'failed'; error = (e as Error).message.slice(0, 300); }
    await tdb.message.create({ data: { channel: 'email', toAddress: user.email, subject, body: text, relatedType: 'job_change', relatedId: c.id, status, providerId, error } as never });
  }
}

/** Approve (optionally with HR's final pay), decline, or cancel. */
export async function decide(ctx: Ctx, changeId: string, raw: unknown) {
  const p = DecideBody.safeParse(raw);
  if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? 'Invalid input');
  const { tdb, org, user, role } = ctx;
  const c = await tdb.jobChange.findFirst({ where: { id: changeId }, include: { employee: { include } } });
  if (!c) throw new HttpError(404, 'That job change was deleted.');
  if (p.data.action === 'cancel') {
    if (!(isAdmin(role) || c.requestedById === user.id)) throw new HttpError(403, 'Only the person who proposed it or HR can cancel it.');
    if (c.status === 'APPROVED' && c.appliedAt) throw new HttpError(409, 'It has already taken effect. Make a new job change to undo it.');
    if (!['PENDING', 'APPROVED'].includes(c.status)) throw new HttpError(409, 'It was already decided.');
    if (c.status === 'APPROVED') await tdb.compensationChange.deleteMany({ where: { employeeId: c.employeeId, reason: { startsWith: `${KINDS[c.kind as Kind]}:` }, effectiveDate: c.effectiveDate, createdAt: { gte: c.decidedAt ?? c.createdAt } } });
    await tdb.jobChange.updateMany({ where: { id: c.id }, data: { status: 'CANCELLED', decidedById: user.id, decidedByName: user.name ?? user.email, decidedAt: new Date(), decisionNote: p.data.note ?? null } });
    await audit(org.id, user, 'employee.job_change', `Cancelled the ${KINDS[c.kind as Kind].toLowerCase()} for ${c.employee.candidate.name}`, { targetType: 'Employee', targetId: c.employeeId });
    return { ok: true, message: 'Cancelled.' };
  }
  if (!isAdmin(role)) throw new HttpError(403, 'Only owners and admins approve job changes.');
  if (c.status !== 'PENDING') throw new HttpError(409, 'It was already decided.');
  if (p.data.action === 'decline') {
    const won = await tdb.jobChange.updateMany({ where: { id: c.id, status: 'PENDING' }, data: { status: 'DECLINED', decidedById: user.id, decidedByName: user.name ?? user.email, decidedAt: new Date(), decisionNote: p.data.note ?? null } });
    if (!won.count) throw new HttpError(409, 'It was already decided.');
    await audit(org.id, user, 'employee.job_change', `Declined the ${KINDS[c.kind as Kind].toLowerCase()} for ${c.employee.candidate.name}${p.data.note ? `: ${p.data.note}` : ''}`, { targetType: 'Employee', targetId: c.employeeId });
    await tellRequester(org, c, user, false, p.data.note);
    return { ok: true, message: 'Declined. The person who asked has been told.' };
  }
  if (p.data.toPayRate !== undefined) await tdb.jobChange.updateMany({ where: { id: c.id }, data: { toPayRate: p.data.toPayRate, toPayType: p.data.toPayType ?? c.toPayType ?? c.fromPayType } });
  return approve(ctx, c.id, { note: p.data.note });
}

async function approve(ctx: Ctx, changeId: string, o: { note?: string }) {
  const { tdb, org, user } = ctx;
  const won = await tdb.jobChange.updateMany({ where: { id: changeId, status: 'PENDING' }, data: { status: 'APPROVED', decidedById: user.id, decidedByName: user.name ?? user.email, decidedAt: new Date(), decisionNote: o.note ?? null } });
  if (!won.count) throw new HttpError(409, 'It was already decided.');
  const c = (await tdb.jobChange.findFirst({ where: { id: changeId }, include: { employee: { include } } }))!;
  const e = c.employee;
  const date = ymd(c.effectiveDate);
  // Title and pay go through pay history, which the daily job applies on the date.
  if (c.toTitle || c.toPayRate !== null) {
    await addCompensation(tdb, org, e.id, { effectiveDate: date, payType: (c.toPayType ?? e.payType) as PayType, payRate: c.toPayRate !== null ? Number(c.toPayRate) : Number(e.payRate), title: c.toTitle, reason: `${KINDS[c.kind as Kind]}: ${c.reason}`.slice(0, 300), userId: user.id });
  }
  const now = date <= localDate(new Date(), org.timezone);
  if (now) await applyStructure(tdb, c);
  await audit(org.id, user, 'employee.job_change', `Approved the ${KINDS[c.kind as Kind].toLowerCase()} for ${e.candidate.name}${c.toTitle ? ` to ${c.toTitle}` : ''}${c.toPayRate !== null ? ` at ${money(Number(c.toPayRate), (c.toPayType ?? e.payType) as PayType)}` : ''}, effective ${date}`, { targetType: 'Employee', targetId: e.id });
  await logActivity(org.id, `${e.candidate.name}: ${KINDS[c.kind as Kind].toLowerCase()}${c.toTitle ? ` to ${c.toTitle}` : ''}, effective ${date}`, user.id);
  let told: string | null = null;
  if (c.notifyEmployee) told = await notifyEmployee(org, c);
  if (c.requestedById !== user.id) await tellRequester(org, c, user, true, o.note);
  return { ok: true, pending: false, applied: now, message: `${now ? 'Done' : `Approved. It takes effect ${date}`}.${c.notifyEmployee ? (told ? ` Couldn’t send ${e.candidate.name.split(' ')[0]} the notice (${told}); tell them in writing yourself.` : ` ${e.candidate.name.split(' ')[0]} has been sent a written notice.`) : ''}` };
}

/** Department, manager and location take effect (title and pay come from pay history). */
async function applyStructure(tdb: TenantDb, c: JobChange) {
  const data: Record<string, string> = {};
  if (c.toDepartmentId && (await tdb.department.findFirst({ where: { id: c.toDepartmentId } }))) data.departmentId = c.toDepartmentId;
  if (c.toBranchId && (await tdb.branch.findFirst({ where: { id: c.toBranchId } }))) data.branchId = c.toBranchId;
  if (c.toManagerId) { try { await checkRefs(tdb, { managerId: c.toManagerId }, c.employeeId); data.managerId = c.toManagerId; } catch { /* the new manager left or it would make a loop: leave the manager as is */ } }
  if (Object.keys(data).length) await tdb.employee.updateMany({ where: { id: c.employeeId }, data });
  await tdb.jobChange.updateMany({ where: { id: c.id }, data: { appliedAt: new Date() } });
}

/** Daily: approved changes whose date has come take effect. */
export async function applyDueJobChanges(tdb: TenantDb, today: string) {
  const due = await tdb.jobChange.findMany({ where: { status: 'APPROVED', appliedAt: null, effectiveDate: { lte: day(today) } }, orderBy: { effectiveDate: 'asc' } });
  for (const c of due) await applyStructure(tdb, c);
  return due.length;
}

async function notifyEmployee(org: Organization, c: JobChange & { employee: { candidate: { name: string; email: string | null; phone: string | null; emailOptOut: boolean; smsOptOut: boolean } } & { payType: PayType; candidateId: string } }) {
  const tdb = tenantDb(org.id);
  const [dept, mgr, branch] = await Promise.all([
    c.toDepartmentId ? tdb.department.findFirst({ where: { id: c.toDepartmentId }, select: { name: true } }) : null,
    c.toManagerId ? tdb.employee.findFirst({ where: { id: c.toManagerId }, select: { candidate: { select: { name: true } } } }) : null,
    c.toBranchId ? tdb.branch.findFirst({ where: { id: c.toBranchId }, select: { name: true } }) : null,
  ]);
  const company = org.shortName ?? org.name;
  const date = new Date(`${ymd(c.effectiveDate)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const lines = [
    c.toTitle && `Position: ${c.toTitle} (was ${c.fromTitle})`,
    c.toPayRate !== null && `Pay: ${money(Number(c.toPayRate), (c.toPayType ?? c.fromPayType) as PayType)} (was ${money(Number(c.fromPayRate), c.fromPayType)})`,
    dept && `Department: ${dept.name}`, mgr && `Manager: ${mgr.candidate.name}`, branch && `Location: ${branch.name}`,
  ].filter(Boolean) as string[];
  const opening = c.kind === 'PROMOTION' ? `Congratulations! You’re being promoted, effective ${date}.` : `This confirms a change to your job, effective ${date}.`;
  const text = [`Hi ${c.employee.candidate.name.split(' ')[0]},`, '', opening, '', ...lines, '', 'If you have questions, talk to your manager or HR.', '', `— ${company}`].join('\n');
  const w = { id: c.employee.candidateId, name: c.employee.candidate.name, email: c.employee.candidate.email, phone: c.employee.candidate.phone, emailOptOut: c.employee.candidate.emailOptOut, smsOptOut: c.employee.candidate.smsOptOut };
  const problem = await deliver(tdb, w, w.email ? 'email' : 'sms', { subject: c.kind === 'PROMOTION' ? `Your promotion at ${company}` : `A change to your job at ${company}`, text }, { name: company }, null);
  if (!problem) await tdb.jobChange.updateMany({ where: { id: c.id }, data: { employeeNotifiedAt: new Date() } });
  return problem;
}

async function tellRequester(org: Organization, c: JobChange & { employee: { candidate: { name: string } } }, by: User, approved: boolean, note?: string) {
  if (!c.requestedById) return;
  const u = await db.user.findUnique({ where: { id: c.requestedById }, select: { email: true } });
  if (!u) return;
  const subject = `${approved ? 'Approved' : 'Declined'}: ${KINDS[c.kind as Kind].toLowerCase()} for ${c.employee.candidate.name}`;
  const text = [`${by.name ?? by.email} ${approved ? 'approved' : 'declined'} the ${KINDS[c.kind as Kind].toLowerCase()} you proposed for ${c.employee.candidate.name}${approved ? `, effective ${ymd(c.effectiveDate)}` : ''}.`, ...(note ? ['', `Note: ${note}`] : [])].join('\n');
  let status = 'sent', providerId: string | null = null, error: string | null = null;
  try { providerId = (await sendEmail({ to: u.email, subject, text, fromName: org.shortName ?? org.name, replyTo: by.email })).id; } catch (e) { status = 'failed'; error = (e as Error).message.slice(0, 300); }
  await tenantDb(org.id).message.create({ data: { channel: 'email', toAddress: u.email, subject, body: text, relatedType: 'job_change', relatedId: c.id, status, providerId, error } as never });
}

/** History for one employee. Pay figures only for owners and admins. */
export async function jobChangesFor(tdb: TenantDb, role: Role, employeeId: string) {
  const rows = await tdb.jobChange.findMany({ where: { employeeId }, orderBy: { createdAt: 'desc' }, take: 50 });
  return rows.map((c) => view(c, role));
}
/** Waiting for approval, for HR. */
export async function pendingJobChanges(tdb: TenantDb, role: Role) {
  const rows = await tdb.jobChange.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, include: { employee: { select: { candidate: { select: { name: true } } } } } });
  return rows.map((c) => ({ ...view(c, role), employee: c.employee.candidate.name }));
}
function view(c: JobChange, role: Role) {
  const pay = isAdmin(role);
  return {
    id: c.id, employeeId: c.employeeId, kind: c.kind as Kind, kindLabel: KINDS[c.kind as Kind], status: c.status, effectiveDate: ymd(c.effectiveDate), reason: c.reason,
    fromTitle: c.fromTitle, toTitle: c.toTitle, toDepartmentId: c.toDepartmentId, toManagerId: c.toManagerId, toBranchId: c.toBranchId,
    payChange: c.toPayRate !== null, fromPay: pay ? money(Number(c.fromPayRate), c.fromPayType) : null, toPay: pay && c.toPayRate !== null ? money(Number(c.toPayRate), (c.toPayType ?? c.fromPayType) as PayType) : null,
    toPayRate: pay && c.toPayRate !== null ? Number(c.toPayRate) : null, toPayType: pay ? c.toPayType ?? c.fromPayType : null,
    requestedBy: c.requestedByName, requestedById: c.requestedById, decidedBy: c.decidedByName, decidedAt: c.decidedAt?.toISOString() ?? null, decisionNote: c.decisionNote,
    applied: !!c.appliedAt, employeeNotified: !!c.employeeNotifiedAt,
  };
}
export type JobChangeView = ReturnType<typeof view>;
