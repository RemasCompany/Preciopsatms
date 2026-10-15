import { z } from 'zod';
import type { EmploymentType, Organization, PayType, Role, User } from '@prisma/client';
import { HttpError, logActivity, tenantDb, type TenantDb } from './tenant';
import { audit } from './audit';
import { db } from './db';
import { localDate } from './timeclock';
import { syncSeats } from './stripe';
import { EMPLOYMENT_TYPES, money } from './people-shared';

/**
 * Employees: people on the company's own payroll. Each one has a person record (Candidate: contact details,
 * documents, credentials, training) and a position (a placement on a job), so scheduling, the time clock,
 * timesheets and payroll treat them like any placed worker. Pay is visible to owners and admins only.
 */
type Ctx = { tdb: TenantDb; org: Organization; user: User; role: Role };
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date.');
const id = z.string().min(1).max(40);
export const isAdmin = (role: Role) => role === 'OWNER' || role === 'ADMIN';
const Pay = {
  payType: z.enum(['HOURLY', 'SALARY'], { errorMap: () => ({ message: 'Choose hourly or salary.' }) }),
  payRate: z.coerce.number({ invalid_type_error: 'Enter the pay rate.' }).min(0, 'Pay can’t be negative.').max(10_000_000, 'That pay looks too high.'),
};
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);

export const NewEmployee = z.object({
  candidateId: id.optional(), // an existing person (e.g. a candidate you hired outside the pipeline)
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().email('Enter a valid email.').optional().or(z.literal('')).transform((v) => v || null),
  phone: optText(30),
  title: z.string().trim().min(1, 'Enter a job title.').max(120),
  departmentId: id.optional().nullable(), branchId: id.optional().nullable(), managerId: id.optional().nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPES).default('FULL_TIME'),
  startDate: DATE, employeeNumber: optText(40), workEmail: z.string().trim().email('Enter a valid work email.').optional().or(z.literal('')).transform((v) => v || null),
  ...Pay,
});
export const EditEmployee = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(120).optional(),
  email: z.string().trim().email('Enter a valid email.').optional().or(z.literal('')).transform((v) => (v === undefined ? undefined : v || null)),
  phone: optText(30), title: z.string().trim().min(1, 'Enter a job title.').max(120).optional(),
  departmentId: id.optional().nullable(), branchId: id.optional().nullable(), managerId: id.optional().nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(), startDate: DATE.optional(), employeeNumber: optText(40),
  workEmail: z.string().trim().email('Enter a valid work email.').optional().or(z.literal('')).transform((v) => (v === undefined ? undefined : v || null)),
  status: z.enum(['ACTIVE', 'ON_LEAVE']).optional(),
}).partial();
export const PayChange = z.object({ effectiveDate: DATE, ...Pay, title: optText(120), reason: z.string().trim().min(2, 'Give a reason (e.g. annual raise, promotion).').max(300) });
export const Termination = z.object({
  endDate: DATE, reason: z.string().trim().min(2, 'Give a reason.').max(300),
  rehire: z.boolean().default(true), // false adds them to the company-wide do-not-rehire list
});

export function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Check the form and try again.');
  return r.data;
}

async function checkRefs(tdb: TenantDb, b: { departmentId?: string | null; branchId?: string | null; managerId?: string | null }, self?: string) {
  if (b.departmentId && !(await tdb.department.findFirst({ where: { id: b.departmentId } }))) throw new HttpError(404, 'That department was deleted.');
  if (b.branchId && !(await tdb.branch.findFirst({ where: { id: b.branchId } }))) throw new HttpError(404, 'That location was deleted.');
  if (b.managerId) {
    if (b.managerId === self) throw new HttpError(400, 'Someone can’t be their own manager.');
    // Walk up from the new manager: reaching this employee would make a loop.
    let at: string | null = b.managerId;
    for (let i = 0; at && i < 200; i++) {
      const m: { id: string; managerId: string | null; status: string } | null = await tdb.employee.findFirst({ where: { id: at }, select: { id: true, managerId: true, status: true } });
      if (!m) throw new HttpError(404, 'That manager isn’t an employee any more.');
      if (i === 0 && m.status === 'TERMINATED') throw new HttpError(400, 'Choose a current employee as manager.');
      if (self && m.managerId === self) throw new HttpError(400, 'That would make a loop: they already report to this person.');
      at = m.managerId;
    }
  }
}

/** The job that holds this position: a matching non-client job, or a new internal (unpublished) one. */
async function positionJob(tdb: TenantDb, title: string, type: EmploymentType, branchId: string | null) {
  const found = await tdb.job.findFirst({ where: { clientId: null, title: { equals: title, mode: 'insensitive' }, type, branchId }, orderBy: { createdAt: 'asc' } });
  return found ?? tdb.job.create({ data: { title, type, branchId, status: 'FILLED', publish: false, openings: 1 } as never });
}

/** Moves the person onto the position (creating or re-using their placement on that job). */
async function place(tdb: TenantDb, candidateId: string, jobId: string) {
  const app = await tdb.application.findFirst({ where: { candidateId, jobId } });
  if (app) { await tdb.application.updateMany({ where: { id: app.id }, data: { stage: 'PLACED', maxStage: 'PLACED', stageChangedAt: new Date() } }); return app.id; }
  return (await tdb.application.create({ data: { candidateId, jobId, stage: 'PLACED', maxStage: 'PLACED' } as never })).id;
}

const billingSync = (orgId: string) => syncSeats(orgId).catch((e) => console.error('[people] billing sync failed', e));

export async function createEmployee(ctx: Ctx, body: unknown) {
  const b = parse(NewEmployee, body);
  const { tdb, org, user } = ctx;
  await checkRefs(tdb, b);
  let cand = b.candidateId ? await tdb.candidate.findFirst({ where: { id: b.candidateId } }) : null;
  if (b.candidateId && !cand) throw new HttpError(404, 'That person was deleted.');
  if (!cand) {
    if (!b.name) throw new HttpError(400, 'Enter the employee’s name.');
    cand = await tdb.candidate.create({ data: { name: b.name, email: b.email, phone: b.phone, title: b.title, status: 'Employee', source: 'Employee', branchId: b.branchId ?? null } as never });
  }
  if (await tdb.employee.findFirst({ where: { candidateId: cand.id } })) throw new HttpError(409, `${cand.name} is already an employee.`);
  const job = await positionJob(tdb, b.title, b.employmentType, b.branchId ?? null);
  const applicationId = await place(tdb, cand.id, job.id);
  const emp = await tdb.employee.create({ data: {
    candidateId: cand.id, applicationId, title: b.title, departmentId: b.departmentId ?? null, branchId: b.branchId ?? null, managerId: b.managerId ?? null,
    employmentType: b.employmentType, startDate: day(b.startDate), payType: b.payType, payRate: b.payRate, employeeNumber: b.employeeNumber, workEmail: b.workEmail,
  } as never });
  await tdb.compensationChange.create({ data: { employeeId: emp.id, effectiveDate: day(b.startDate), payType: b.payType, payRate: b.payRate, title: b.title, reason: 'Hired', createdById: user.id } as never });
  await audit(org.id, user, 'employee.create', `Added ${cand.name} as ${b.title}`, { targetType: 'Employee', targetId: emp.id });
  await logActivity(org.id, `Added employee ${cand.name} (${b.title})`, user.id);
  await billingSync(org.id);
  return emp;
}

/** Hired through the pipeline (an employer moved someone to Hired): they become an employee in that position. */
export async function hireFromPipeline(tdb: TenantDb, org: Organization, user: User, applicationId: string) {
  if (org.kind !== 'EMPLOYER') return null;
  const app = await tdb.application.findFirst({ where: { id: applicationId }, include: { candidate: { select: { id: true, name: true } }, job: true } });
  if (!app) return null;
  const type: EmploymentType = app.job.type === 'DIRECT_HIRE' || app.job.type === 'CONTRACT_TO_HIRE' ? 'FULL_TIME' : app.job.type;
  // Direct-hire jobs aren't scheduled; an employer's hire works their position, so it becomes a full-time one.
  if (app.job.type !== type) await tdb.job.updateMany({ where: { id: app.jobId }, data: { type } });
  const today = localDate(new Date(), org.timezone);
  const start = app.job.startDate && ymd(app.job.startDate) > today ? ymd(app.job.startDate) : today;
  const existing = await tdb.employee.findFirst({ where: { candidateId: app.candidateId } });
  if (existing) {
    // A current or former employee hired into a new role: a transfer or a rehire.
    await tdb.employee.updateMany({ where: { id: existing.id }, data: { applicationId: app.id, title: app.job.title, employmentType: type, branchId: app.job.branchId,
      ...(existing.status === 'TERMINATED' ? { status: 'ACTIVE', startDate: day(start), endDate: null, endReason: null } : {}) } });
    await tdb.candidate.updateMany({ where: { id: app.candidateId }, data: { status: 'Employee' } });
    await tdb.compensationChange.create({ data: { employeeId: existing.id, effectiveDate: day(start), payType: existing.payType, payRate: existing.payRate, title: app.job.title, reason: existing.status === 'TERMINATED' ? 'Rehired' : 'Transfer', createdById: user.id } as never });
    await billingSync(org.id);
    return existing.id;
  }
  const pay = Number(app.job.payRate ?? 0);
  await tdb.candidate.updateMany({ where: { id: app.candidateId }, data: { status: 'Employee' } });
  const emp = await tdb.employee.create({ data: { candidateId: app.candidateId, applicationId: app.id, title: app.job.title, employmentType: type, branchId: app.job.branchId, startDate: day(start), payType: 'HOURLY', payRate: pay } as never });
  await tdb.compensationChange.create({ data: { employeeId: emp.id, effectiveDate: day(start), payType: 'HOURLY', payRate: pay, title: app.job.title, reason: 'Hired', createdById: user.id } as never });
  await logActivity(org.id, `${app.candidate.name} was hired as ${app.job.title} and added to Employees`, user.id);
  await billingSync(org.id);
  return emp.id;
}

export async function updateEmployee(ctx: Ctx, employeeId: string, body: unknown) {
  const b = parse(EditEmployee, body);
  const { tdb, org, user } = ctx;
  const e = await tdb.employee.findFirst({ where: { id: employeeId }, include: { candidate: true } });
  if (!e) throw new HttpError(404, 'That employee was deleted.');
  if (e.status === 'TERMINATED' && b.status) throw new HttpError(409, 'Their employment has ended. Rehire them through the pipeline or add them again.');
  await checkRefs(tdb, b, e.id);
  const person = { ...(b.name !== undefined ? { name: b.name } : {}), ...(b.email !== undefined ? { email: b.email } : {}), ...(b.phone !== undefined ? { phone: b.phone } : {}) };
  if (Object.keys(person).length) await tdb.candidate.updateMany({ where: { id: e.candidateId }, data: person });
  const data: Record<string, unknown> = {};
  for (const k of ['title', 'departmentId', 'branchId', 'managerId', 'employmentType', 'employeeNumber', 'workEmail', 'status'] as const) if (b[k] !== undefined) data[k] = b[k];
  if (b.startDate) data.startDate = day(b.startDate);
  // A new title or type moves them to the matching position, so schedules and timesheets show it.
  if ((b.title && b.title !== e.title) || (b.employmentType && b.employmentType !== e.employmentType) || (b.branchId !== undefined && b.branchId !== e.branchId)) {
    const job = await positionJob(tdb, b.title ?? e.title, b.employmentType ?? e.employmentType, b.branchId !== undefined ? b.branchId ?? null : e.branchId);
    if (e.applicationId) {
      const cur = await tdb.application.findFirst({ where: { id: e.applicationId } });
      if (cur && cur.jobId !== job.id) {
        // Keep their shifts and timesheets: move the existing placement to the new position when it's free to move.
        const clash = await tdb.application.findFirst({ where: { candidateId: e.candidateId, jobId: job.id } });
        data.applicationId = clash ? await place(tdb, e.candidateId, job.id) : (await tdb.application.updateMany({ where: { id: cur.id }, data: { jobId: job.id } }), cur.id);
      }
    } else data.applicationId = await place(tdb, e.candidateId, job.id);
  }
  if (Object.keys(data).length) await tdb.employee.updateMany({ where: { id: e.id }, data });
  await audit(org.id, user, 'employee.update', `Changed ${b.name ?? e.candidate.name}: ${[...Object.keys(person), ...Object.keys(data).filter((k) => k !== 'applicationId')].join(', ') || 'no changes'}`, { targetType: 'Employee', targetId: e.id });
  if (b.status && b.status !== e.status) await billingSync(org.id);
  return { ok: true };
}

/** A raise, promotion or correction. Dated today or earlier it applies now; a future date applies on that day. */
export async function changePay(ctx: Ctx, employeeId: string, body: unknown) {
  if (!isAdmin(ctx.role)) throw new HttpError(403, 'Only owners and admins can change pay.');
  const b = parse(PayChange, body);
  const { tdb, org, user } = ctx;
  const e = await tdb.employee.findFirst({ where: { id: employeeId }, include: { candidate: { select: { name: true } } } });
  if (!e) throw new HttpError(404, 'That employee was deleted.');
  if (e.status === 'TERMINATED') throw new HttpError(409, 'Their employment has ended.');
  await tdb.compensationChange.create({ data: { employeeId: e.id, effectiveDate: day(b.effectiveDate), payType: b.payType, payRate: b.payRate, title: b.title, reason: b.reason, createdById: user.id } as never });
  const now = b.effectiveDate <= localDate(new Date(), org.timezone);
  if (now) await applyPay(tdb, e.id, { payType: b.payType, payRate: b.payRate, title: b.title });
  await audit(org.id, user, 'employee.pay', `Changed ${e.candidate.name}’s pay to ${money(b.payRate, b.payType)} from ${b.effectiveDate} (${b.reason})`, { targetType: 'Employee', targetId: e.id });
  return { applied: now };
}

async function applyPay(tdb: TenantDb, employeeId: string, c: { payType: PayType; payRate: unknown; title: string | null }) {
  await tdb.employee.updateMany({ where: { id: employeeId }, data: { payType: c.payType, payRate: c.payRate as never } });
  if (c.title) await updateTitle(tdb, employeeId, c.title);
}
async function updateTitle(tdb: TenantDb, employeeId: string, title: string) {
  const e = await tdb.employee.findFirst({ where: { id: employeeId } });
  if (!e || e.title === title) return;
  const job = await positionJob(tdb, title, e.employmentType, e.branchId);
  let applicationId = e.applicationId;
  if (applicationId) {
    const clash = await tdb.application.findFirst({ where: { candidateId: e.candidateId, jobId: job.id } });
    if (clash) applicationId = await place(tdb, e.candidateId, job.id);
    else await tdb.application.updateMany({ where: { id: applicationId }, data: { jobId: job.id } });
  } else applicationId = await place(tdb, e.candidateId, job.id);
  await tdb.employee.updateMany({ where: { id: e.id }, data: { title, applicationId } });
}


/** Ends employment. Dated today or earlier it takes effect now: future shifts come off the schedule. */
export async function terminate(ctx: Ctx, employeeId: string, body: unknown) {
  if (!isAdmin(ctx.role)) throw new HttpError(403, 'Only owners and admins can end someone’s employment.');
  const b = parse(Termination, body);
  const { tdb, org, user } = ctx;
  const e = await tdb.employee.findFirst({ where: { id: employeeId }, include: { candidate: { select: { id: true, name: true } } } });
  if (!e) throw new HttpError(404, 'That employee was deleted.');
  if (e.status === 'TERMINATED') throw new HttpError(409, 'Their employment has already ended.');
  if (b.endDate < ymd(e.startDate)) throw new HttpError(400, 'The last day can’t be before they started.');
  await tdb.employee.updateMany({ where: { id: e.id }, data: { endDate: day(b.endDate), endReason: b.reason } });
  // Direct reports move up to this person's manager.
  await tdb.employee.updateMany({ where: { managerId: e.id }, data: { managerId: e.managerId } });
  if (!b.rehire && !(await tdb.doNotReturn.findFirst({ where: { candidateId: e.candidateId, clientId: null, liftedAt: null } }))) {
    await tdb.doNotReturn.create({ data: { candidateId: e.candidateId, clientId: null, reason: `Not eligible for rehire: ${b.reason}`, source: 'staff', createdById: user.id } as never });
  }
  const effective = b.endDate <= localDate(new Date(), org.timezone);
  const removed = effective ? await endNow(tdb, e.id, b.endDate) : 0;
  await audit(org.id, user, 'employee.terminate', `Ended ${e.candidate.name}’s employment, last day ${b.endDate} (${b.reason})${b.rehire ? '' : ', not eligible for rehire'}`, { targetType: 'Employee', targetId: e.id });
  await logActivity(org.id, `${e.candidate.name}’s last day: ${b.endDate}`, user.id);
  await billingSync(org.id);
  return { removedShifts: removed, effective };
}

/** Marks them ended and takes shifts after the last day off the schedule (unsent ones deleted, sent ones cancelled). */
async function endNow(tdb: TenantDb, employeeId: string, lastDay: string) {
  const e = await tdb.employee.findFirst({ where: { id: employeeId } });
  if (!e) return 0;
  await tdb.employee.updateMany({ where: { id: e.id }, data: { status: 'TERMINATED' } });
  await tdb.candidate.updateMany({ where: { id: e.candidateId }, data: { status: 'Former employee' } });
  // Their private employee page (schedule, time clock, pay) stops working.
  await tdb.workerLink.updateMany({ where: { candidateId: e.candidateId, kind: 'timeclock', revokedAt: null }, data: { revokedAt: new Date() } });
  const after = { application: { candidateId: e.candidateId }, date: { gt: day(lastDay) }, cancelled: false };
  const { count: del } = await tdb.shift.deleteMany({ where: { ...after, notifiedAt: null } });
  const { count: can } = await tdb.shift.updateMany({ where: after, data: { cancelled: true, notified: false } });
  return del + can;
}

/** Daily: future-dated pay changes and last days take effect. Runs across every company. */
export async function runPeopleDaily(now = new Date()) {
  let pay = 0, ended = 0;
  const orgs = await db.organization.findMany({ where: { employees: { some: {} } }, select: { id: true, timezone: true } });
  for (const o of orgs) {
    const today = localDate(now, o.timezone);
    const tdb = tenantDb(o.id);
    const due = await tdb.compensationChange.findMany({ where: { effectiveDate: { lte: day(today) }, employee: { status: { not: 'TERMINATED' } } }, orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }] });
    // Only the newest change per employee matters; apply it if the employee doesn't already reflect it.
    const latest = new Map(due.map((c) => [c.employeeId, c]));
    for (const c of latest.values()) {
      const e = await tdb.employee.findFirst({ where: { id: c.employeeId } });
      if (e && (Number(e.payRate) !== Number(c.payRate) || e.payType !== c.payType || (c.title && c.title !== e.title))) { await applyPay(tdb, e.id, c); pay++; }
    }
    const leaving = await tdb.employee.findMany({ where: { status: { not: 'TERMINATED' }, endDate: { lte: day(today) } } });
    for (const e of leaving) { await endNow(tdb, e.id, ymd(e.endDate!)); ended++; }
    if (leaving.length) await billingSync(o.id);
  }
  return { pay, ended };
}

export const DepartmentBody = z.object({ name: z.string().trim().min(1, 'Enter a department name.').max(80) });

export async function employeeList(tdb: TenantDb, role: Role, f: { status?: string; department?: string; branch?: string; q?: string } = {}) {
  const rows = await tdb.employee.findMany({
    where: {
      ...(f.status === 'all' ? {} : f.status === 'TERMINATED' ? { status: 'TERMINATED' } : f.status === 'ON_LEAVE' ? { status: 'ON_LEAVE' } : { status: { not: 'TERMINATED' } }),
      ...(f.department ? { departmentId: f.department } : {}), ...(f.branch ? { branchId: f.branch } : {}),
      ...(f.q ? { OR: [{ candidate: { name: { contains: f.q, mode: 'insensitive' } } }, { title: { contains: f.q, mode: 'insensitive' } }, { employeeNumber: { contains: f.q, mode: 'insensitive' } }] } : {}),
    },
    include: { candidate: { select: { id: true, name: true, email: true, phone: true } }, department: { select: { name: true } }, branch: { select: { name: true } }, manager: { select: { candidate: { select: { name: true } } } }, _count: { select: { reports: true } } },
    orderBy: { candidate: { name: 'asc' } },
  });
  const pay = isAdmin(role);
  return rows.map((e) => ({
    id: e.id, candidateId: e.candidateId, name: e.candidate.name, email: e.candidate.email, phone: e.candidate.phone, title: e.title,
    department: e.department?.name ?? null, departmentId: e.departmentId, location: e.branch?.name ?? null, branchId: e.branchId,
    manager: e.manager?.candidate.name ?? null, managerId: e.managerId, reports: e._count.reports, employmentType: e.employmentType,
    status: e.status, startDate: ymd(e.startDate), endDate: e.endDate ? ymd(e.endDate) : null, endReason: e.endReason, employeeNumber: e.employeeNumber, workEmail: e.workEmail,
    // Pay is for owners and admins only.
    payType: pay ? e.payType : null, payRate: pay ? Number(e.payRate) : null,
  }));
}
export type EmployeeRow = Awaited<ReturnType<typeof employeeList>>[number];

export async function payHistory(tdb: TenantDb, employeeId: string) {
  const rows = await tdb.compensationChange.findMany({ where: { employeeId }, orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }] });
  return rows.map((c) => ({ id: c.id, effectiveDate: ymd(c.effectiveDate), payType: c.payType, payRate: Number(c.payRate), title: c.title, reason: c.reason }));
}
