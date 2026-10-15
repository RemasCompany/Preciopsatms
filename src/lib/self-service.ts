import { z } from 'zod';
import type { Organization } from '@prisma/client';
import { HttpError, logActivity, tenantDb } from './tenant';
import { hasFeature } from './plans';
import { balances, requestLeave, tracked } from './leave';
import { hoursAmount, leaveAmount } from './payroll';
import { totals, type RunItem } from './payroll-run';

/**
 * An employee's own page, on the private link they already use for their schedule and time clock: their job,
 * time off (balances, requests), pay stubs, signed documents and contact details. Only for employees.
 */
const ymd = (d: Date) => d.toISOString().slice(0, 10);
type Link = { organizationId: string; organization: Organization; candidate: { id: string; name: string } };

export async function employeeHub(link: Link) {
  const o = link.organization;
  if (!hasFeature(o, 'people')) return null;
  const tdb = tenantDb(o.id);
  const e = await tdb.employee.findFirst({ where: { candidateId: link.candidate.id, status: { not: 'TERMINATED' } },
    include: { candidate: { select: { email: true, phone: true } }, department: { select: { name: true } }, branch: { select: { name: true } }, manager: { select: { candidate: { select: { name: true } } } } } });
  if (!e) return null;

  let timeOff = null;
  if (hasFeature(o, 'timeoff')) {
    const [policies, requests] = await Promise.all([
      tdb.leavePolicy.findMany({ where: { archived: false }, orderBy: { name: 'asc' } }),
      tdb.leaveRequest.findMany({ where: { employeeId: e.id, OR: [{ status: 'PENDING' }, { endDate: { gte: new Date(Date.now() - 60 * 864e5) } }] }, include: { policy: { select: { name: true } } }, orderBy: { startDate: 'desc' }, take: 20 }),
    ]);
    const bal = await balances(tdb, [e.id]);
    const offered = policies.filter((p) => !p.types.length || p.types.includes(e.employmentType));
    timeOff = {
      policies: offered.map((p) => ({ id: p.id, name: p.name, paid: p.paid, tracked: tracked(p), ...(tracked(p) ? bal.get(e.id, p.id) : { balance: null, pending: null }),
        usableFrom: p.waitingDays ? ymd(new Date(e.startDate.getTime() + p.waitingDays * 864e5)) : null })),
      requests: requests.map((r) => ({ id: r.id, policy: r.policy.name, start: ymd(r.startDate), end: ymd(r.endDate), hours: Number(r.hours), status: r.status, note: r.note, reply: r.decisionNote })),
    };
  }

  // Pay: statements from approved or paid payroll runs; without runs, their approved weeks of hours.
  const items = await tdb.payrollItem.findMany({ where: { candidateId: e.candidateId, run: { status: { in: ['APPROVED', 'PAID'] } } }, include: { run: true, adjustments: true }, orderBy: { weekEnding: 'desc' }, take: 200 });
  const runs = new Map<string, typeof items>();
  for (const i of items) runs.set(i.runId, [...(runs.get(i.runId) ?? []), i]);
  const stubs = [...runs.values()].map((list) => {
    const r = list[0].run;
    const t = totals(list.map((i): RunItem => ({ id: i.id, candidateId: i.candidateId, workerName: i.workerName, payrollId: i.payrollId, position: i.position, clientId: i.clientId, clientName: i.clientName,
      weekEnding: ymd(i.weekEnding), regularHours: Number(i.regularHours), overtimeHours: Number(i.overtimeHours), payRate: Number(i.payRate), billRate: Number(i.billRate),
      regularPay: Number(i.regularPay), overtimePay: Number(i.overtimePay), leaveHours: Number(i.leaveHours), leavePay: Number(i.leavePay),
      adjustments: i.adjustments.map((a) => ({ id: a.id, kind: a.kind, description: a.description, amount: Number(a.amount) })) })));
    return { runId: r.id, number: r.number, payDate: ymd(r.payDate), periodStart: ymd(r.periodStart), periodEnd: ymd(r.periodEnd), hours: +(t.hours + t.leaveHours).toFixed(2), gross: t.gross / 100, paid: r.status === 'PAID' };
  }).sort((a, b) => b.payDate.localeCompare(a.payDate)).slice(0, 26);
  const weeks = stubs.length || !e.applicationId ? [] : (await tdb.timesheet.findMany({ where: { applicationId: e.applicationId, status: { in: ['APPROVED', 'PAID'] } }, orderBy: { weekEnding: 'desc' }, take: 12 }))
    .map((t) => ({ weekEnding: ymd(t.weekEnding), regular: Number(t.regularHours), overtime: Number(t.overtimeHours), leave: Number(t.leaveHours),
      gross: hoursAmount(Number(t.regularHours), Number(t.overtimeHours), Number(t.payRate)) + leaveAmount(Number(t.leaveHours), Number(t.payRate)), paid: t.status === 'PAID' }));

  const docs = hasFeature(o, 'esign') ? await tdb.signDocument.findMany({ where: { relatedType: 'candidate', relatedId: e.candidateId, status: { not: 'DRAFT' } }, orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, title: true, status: true, signedAt: true, pdfFileId: true, createdAt: true } }) : [];

  return {
    job: { title: e.title, department: e.department?.name ?? null, location: e.branch?.name ?? null, manager: e.manager?.candidate.name ?? null, startDate: ymd(e.startDate), status: e.status, employeeNumber: e.employeeNumber, salaried: e.payType === 'SALARY' },
    contact: { email: e.candidate.email, phone: e.candidate.phone },
    timeOff, stubs, weeks,
    documents: docs.map((d) => ({ id: d.id, title: d.title, status: d.status, signedAt: d.signedAt ? ymd(d.signedAt) : null, sent: ymd(d.createdAt), download: !!d.pdfFileId })),
  };
}

const Profile = z.object({
  email: z.string().trim().email('Enter a valid email address.').or(z.literal('')).optional(),
  phone: z.string().trim().max(30, 'That phone number is too long.').regex(/^[\d\s()+.-]*$/, 'Use digits for the phone number.').optional(),
});
const Action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('leave'), policyId: z.string(), startDate: z.string(), endDate: z.string(), hoursPerDay: z.coerce.number(), note: z.string().max(500).optional() }),
  z.object({ action: z.literal('cancelLeave'), requestId: z.string() }),
  z.object({ action: z.literal('profile'), email: z.string().optional(), phone: z.string().optional() }),
]);

/** What an employee can do from their own page. Everything is scoped to the person behind the link. */
export async function employeeAction(link: Link, body: unknown) {
  const p = Action.safeParse(body);
  if (!p.success) throw new HttpError(400, 'Check the form and try again.');
  const o = link.organization;
  const tdb = tenantDb(o.id);
  const e = await tdb.employee.findFirst({ where: { candidateId: link.candidate.id, status: { not: 'TERMINATED' } } });
  if (!e || !hasFeature(o, 'people')) throw new HttpError(404, 'This page is for employees.');
  const b = p.data;
  if (b.action === 'leave') {
    if (!hasFeature(o, 'timeoff')) throw new HttpError(404, 'Time off isn’t set up here. Ask your manager.');
    const r = await requestLeave({ tdb, org: o, user: null }, { employeeId: e.id, policyId: b.policyId, startDate: b.startDate, endDate: b.endDate, hoursPerDay: b.hoursPerDay, note: b.note }, { byEmployee: true });
    return { message: `Sent. You asked for ${r.hours} hours over ${r.days} day${r.days === 1 ? '' : 's'}; you’ll see the answer here.` };
  }
  if (b.action === 'cancelLeave') {
    const r = await tdb.leaveRequest.findFirst({ where: { id: b.requestId, employeeId: e.id } });
    if (!r) throw new HttpError(404, 'That request isn’t yours.');
    if (r.status !== 'PENDING') throw new HttpError(409, r.status === 'APPROVED' ? 'It’s already approved. Ask your manager to cancel it.' : 'That request is already closed.');
    await tdb.leaveRequest.updateMany({ where: { id: r.id, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: new Date(), decisionNote: 'Cancelled by the employee' } });
    await logActivity(o.id, `${link.candidate.name} withdrew a time-off request (${ymd(r.startDate)})`);
    return { message: 'Request withdrawn.' };
  }
  const c = Profile.safeParse({ email: b.email, phone: b.phone });
  if (!c.success) throw new HttpError(400, c.error.issues[0]?.message ?? 'Check your details.');
  const data = { ...(c.data.email !== undefined ? { email: c.data.email || null } : {}), ...(c.data.phone !== undefined ? { phone: c.data.phone || null } : {}) };
  if (!Object.keys(data).length) return { message: 'Nothing to change.' };
  await tdb.candidate.updateMany({ where: { id: link.candidate.id }, data });
  await logActivity(o.id, `${link.candidate.name} updated their ${Object.keys(data).join(' and ')} from their employee page`);
  return { message: 'Saved. Thanks for keeping your details current.' };
}
