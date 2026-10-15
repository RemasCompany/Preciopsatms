import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ id: 'e1' })) }));
vi.mock('@/lib/sms', () => ({ sendSms: vi.fn(async () => ({ id: 's1' })) }));

import { db } from '@/lib/db';
import { POST as ADD_EMP } from '@/app/api/employees/route';
import { POST as POLICY } from '@/app/api/time-off/policies/route';
import { POST as ASK } from '@/app/api/time-off/requests/route';
import { POST as DECIDE } from '@/app/api/time-off/requests/[id]/route';
import { POST as ADJUST } from '@/app/api/time-off/adjust/route';
import { POST as SHIFT } from '@/app/api/shifts/route';
import { POST as BULK } from '@/app/api/shifts/bulk/route';
import { PUT as HOURS } from '@/app/api/timesheets/route';
import { POST as APPROVE } from '@/app/api/timesheets/approve/route';
import { runLeaveAccruals } from '@/lib/leave';
import { timesheetRows } from '@/lib/timesheets';
import { exportRun, totals, type RunItem } from '@/lib/payroll-run';
import { tenantDb } from '@/lib/tenant';

const RUN = `lv${Date.now()}`;
let org: string, other: string, owner: string, hr: string, viewer: string, outsider: string;
let ana: string, anaApp: string, sal: string, part: string, vacation: string, sick: string, unpaid: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const req = (method: string, body?: object) => new Request('http://x', { method, body: body ? JSON.stringify(body) : undefined });
const p = (id: string) => ({ params: { id } });
const json = async (r: Response) => ({ status: r.status, body: await r.json() });
vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-14T15:00:00Z') });
afterAll(() => { vi.useRealTimers(); });
const ask = (o: object) => ASK(req('POST', { employeeId: ana, policyId: vacation, hoursPerDay: 8, ...o })).then(json);

beforeAll(async () => {
  const mk = (n: string) => db.organization.create({ data: { name: n, slug: `${n.toLowerCase()}-${RUN}`, plan: 'growth', subscriptionStatus: 'active', kind: 'EMPLOYER', timezone: 'America/Chicago' } }).then((o) => o.id);
  [org, other] = await Promise.all([mk('Acme'), mk('Other')]);
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [owner, hr, viewer, outsider] = await Promise.all([u('owner'), u('hr'), u('viewer'), u('outsider')]);
  await db.membership.createMany({ data: [{ userId: owner, organizationId: org, role: 'OWNER' }, { userId: hr, organizationId: org, role: 'RECRUITER' }, { userId: viewer, organizationId: org, role: 'VIEWER' }, { userId: outsider, organizationId: other, role: 'OWNER' }] });
  as(owner);
  const emp = async (o: object) => (await (await ADD_EMP(req('POST', { email: '', employmentType: 'FULL_TIME', startDate: '2025-01-06', payType: 'HOURLY', payRate: 20, ...o }))).json()).id;
  ana = await emp({ name: 'Ana Ruiz', title: 'Picker' });
  sal = await emp({ name: 'Sal Ary', title: 'Office Manager', payType: 'SALARY', payRate: 60000 });
  part = await emp({ name: 'Pat Part', title: 'Picker', employmentType: 'PART_TIME', startDate: '2026-10-01' });
  anaApp = (await db.employee.findFirstOrThrow({ where: { id: ana } })).applicationId!;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('policies and balances', () => {
  it('validates policies and keeps them to admins', async () => {
    as(owner);
    expect((await json(await POLICY(req('POST', { name: 'Sick', method: 'HOURS_WORKED', rate: 2 })))).body.error).toMatch(/1 or less/);
    vacation = (await json(await POLICY(req('POST', { name: 'Vacation', method: 'ANNUAL', rate: 96, maxBalance: 120, types: ['FULL_TIME'] })))).body.id;
    sick = (await json(await POLICY(req('POST', { name: 'Sick', method: 'HOURS_WORKED', rate: 1 / 30, maxBalance: 48, waitingDays: 90 })))).body.id;
    unpaid = (await json(await POLICY(req('POST', { name: 'Unpaid leave', paid: false, method: 'NONE' })))).body.id;
    expect((await json(await POLICY(req('POST', { name: 'vacation', method: 'NONE' })))).status).toBe(409);
    as(hr);
    expect((await POLICY(req('POST', { name: 'Floating', method: 'NONE' }))).status).toBe(403);
  });

  it('credits annual policies monthly, once, to eligible employees only', async () => {
    const first = await runLeaveAccruals(new Date('2026-10-14T15:00:00Z'));
    const again = await runLeaveAccruals(new Date('2026-10-20T15:00:00Z'));
    expect(first.credited).toBeGreaterThan(0);
    expect(again.credited).toBeCloseTo(1.33, 2); // same month: no more vacation; a new week for the salaried sick accrual
    const bal = async (e: string, pol: string) => Number((await db.leaveEntry.aggregate({ where: { employeeId: e, policyId: pol }, _sum: { hours: true } }))._sum.hours ?? 0);
    expect(await bal(ana, vacation)).toBe(8); // 96 / 12
    expect(await bal(part, vacation)).toBe(0); // part-time isn't eligible, and started after the 1st
    // Salaried staff on hours-worked policies earn 40 hours' worth for the last full week.
    expect(await bal(sal, sick)).toBeCloseTo(2.66, 2);
  });

  it('adjusts balances (admins only) and caps accruals', async () => {
    as(hr);
    expect((await ADJUST(req('POST', { employeeId: ana, policyId: vacation, hours: 40, note: 'Starting balance' }))).status).toBe(403);
    as(owner);
    expect((await ADJUST(req('POST', { employeeId: ana, policyId: vacation, hours: 40, note: 'Starting balance' }))).status).toBe(201);
    expect((await json(await ADJUST(req('POST', { employeeId: ana, policyId: unpaid, hours: 4, note: 'x x' })))).body.error).toBe('Unpaid leave isn’t tracked, so it has no balance.');
  });
});

let reqId: string;
describe('requests', () => {
  it('checks dates, eligibility, waiting periods and balances', async () => {
    as(hr);
    expect((await ask({ startDate: '2026-10-20', endDate: '2026-10-19' })).body.error).toBe('The last day is before the first day.');
    expect((await ask({ employeeId: part, startDate: '2026-10-20', endDate: '2026-10-20' })).body.error).toMatch(/isn’t offered to part-time/);
    expect((await ask({ policyId: sick, employeeId: part, startDate: '2026-10-20', endDate: '2026-10-20' })).body.error).toMatch(/can be used from 2026-12-30/);
    expect((await ask({ startDate: '2026-10-24', endDate: '2026-10-25' })).body.error).toMatch(/all weekends/);
    expect((await ask({ startDate: '2026-10-19', endDate: '2026-10-30' })).body.error).toBe('That’s 80 hours, and only 48 vacation hours are available.');
    const ok = await ask({ startDate: '2026-10-21', endDate: '2026-10-23', note: 'Family visit' });
    expect(ok).toMatchObject({ status: 201, body: { hours: 24, days: 3 } });
    reqId = ok.body.id;
    expect((await ask({ startDate: '2026-10-23', endDate: '2026-10-23' })).body.error).toMatch(/overlaps a pending vacation request/);
    expect((await ask({ startDate: '2026-10-26', endDate: '2026-10-29' })).body.error).toBe('That’s 32 hours, and only 24 vacation hours are available (24 already requested).');
    as(viewer);
    expect((await ask({ startDate: '2026-11-02', endDate: '2026-11-02' })).status).toBe(403);
  });

  it('approving records each day, clears their shifts, and blocks new ones', async () => {
    as(hr);
    await db.shift.createMany({ data: [
      { organizationId: org, applicationId: anaApp, date: new Date('2026-10-21T00:00:00Z'), start: '07:00', end: '15:30', breakMinutes: 30 },
      { organizationId: org, applicationId: anaApp, date: new Date('2026-10-22T00:00:00Z'), start: '07:00', end: '15:30', breakMinutes: 30, notified: true, notifiedAt: new Date() },
      { organizationId: org, applicationId: anaApp, date: new Date('2026-10-20T00:00:00Z'), start: '07:00', end: '15:30', breakMinutes: 30 },
    ] });
    // With shifts in the range, only the scheduled days count.
    const r = await json(await DECIDE(req('POST', { action: 'approve' }), p(reqId)));
    expect(r.body).toMatchObject({ status: 'APPROVED', hours: 16, removedShifts: 2 });
    expect(await db.leaveEntry.count({ where: { requestId: reqId, kind: 'USAGE' } })).toBe(2);
    expect(await db.shift.count({ where: { applicationId: anaApp, cancelled: false, date: { gte: new Date('2026-10-21T00:00:00Z') } } })).toBe(0);
    const add = await json(await SHIFT(req('POST', { applicationId: anaApp, dates: ['2026-10-22'], start: '07:00', end: '15:30', breakMinutes: 30 })));
    expect([add.status, add.body.error]).toEqual([409, 'They’re on approved time off (Vacation) on Thu, Oct 22.']);
    const plan = await json(await BULK(req('POST', { dryRun: true, applicationIds: [anaApp], dates: ['2026-10-21'], start: '07:00', end: '15:00', breakMinutes: 0 })));
    expect(plan.body.items[0].blocked).toBe('On approved time off (Vacation) Wed, Oct 21.');
    expect((await json(await DECIDE(req('POST', { action: 'approve' }), p(reqId)))).status).toBe(409);
  });

  it('puts paid time off on the hourly employee’s timesheet, paid and exported', async () => {
    const week = new Date('2026-10-25T00:00:00Z');
    const t = await db.timesheet.findFirstOrThrow({ where: { applicationId: anaApp, weekEnding: week } });
    expect([Number(t.leaveHours), Number(t.payRate), t.status]).toEqual([16, 20, 'DRAFT']);
    as(owner);
    expect((await HOURS(req('PUT', { applicationId: anaApp, week: '2026-10-25', regularHours: 8, overtimeHours: 0 }))).status).toBeLessThan(300);
    const row = (await timesheetRows(tenantDb(org), week)).find((x) => x.worker === 'Ana Ruiz')!;
    expect([row.reg, row.leave, row.gross, row.billable]).toEqual([8, 16, 480, 0]);
    const item: RunItem = { id: 'i', candidateId: 'c', workerName: 'Ana Ruiz', payrollId: 'E1', position: 'Picker', clientId: null, clientName: null, weekEnding: '2026-10-25',
      regularHours: 8, overtimeHours: 0, payRate: 20, billRate: 0, regularPay: 160, overtimePay: 0, leaveHours: 16, leavePay: 320, adjustments: [] };
    expect(totals([item]).wages).toBe(48000);
    const run = { number: 'PR-1', periodStart: '2026-10-19', periodEnd: '2026-10-25', payDate: '2026-10-30' };
    expect(exportRun('paychex', run, [item])).toContain(',PTO,16.00,20.00,320.00,2026-10-30');
    expect(exportRun('csv', run, [item])).toContain('16.00,320.00,0.00,0.00,480.00');
  });

  it('cancelling gives the hours back and takes them off the timesheet', async () => {
    as(hr);
    const r = await json(await DECIDE(req('POST', { action: 'cancel' }), p(reqId)));
    expect(r.body).toEqual({ status: 'CANCELLED', lockedWeeks: [] });
    expect(await db.leaveEntry.count({ where: { requestId: reqId } })).toBe(0);
    expect(Number((await db.timesheet.findFirstOrThrow({ where: { applicationId: anaApp, weekEnding: new Date('2026-10-25T00:00:00Z') } })).leaveHours)).toBe(0);
    expect((await SHIFT(req('POST', { applicationId: anaApp, dates: ['2026-10-22'], start: '07:00', end: '15:30', breakMinutes: 30 }))).status).toBe(201);
  });

  it('denies with a note; unpaid leave has no balance check', async () => {
    as(hr);
    const u = await ask({ policyId: unpaid, startDate: '2026-11-09', endDate: '2026-11-13' });
    expect(u.body.hours).toBe(40);
    expect((await json(await DECIDE(req('POST', { action: 'deny', note: 'Peak season' }), p(u.body.id)))).body.status).toBe('DENIED');
    expect((await db.leaveRequest.findFirstOrThrow({ where: { id: u.body.id } })).decisionNote).toBe('Peak season');
  });

  it('earns sick time from approved hours, and takes it back when the timesheet is reopened', async () => {
    as(owner);
    await HOURS(req('PUT', { applicationId: anaApp, week: '2026-10-11', regularHours: 40, overtimeHours: 5 }));
    await APPROVE(req('POST', { week: '2026-10-11', action: 'approve', applicationIds: [anaApp] }));
    const earned = () => db.leaveEntry.aggregate({ where: { employeeId: ana, policyId: sick }, _sum: { hours: true } }).then((x) => Number(x._sum.hours ?? 0));
    expect(await earned()).toBe(1.5);
    await APPROVE(req('POST', { week: '2026-10-11', action: 'reopen', applicationIds: [anaApp] }));
    expect(await earned()).toBe(0);
    await APPROVE(req('POST', { week: '2026-10-11', action: 'approve', applicationIds: [anaApp] }));
    expect(await earned()).toBe(1.5);
  });

  it('keeps every company’s time off to itself', async () => {
    as(outsider, other);
    expect((await DECIDE(req('POST', { action: 'cancel' }), p(reqId))).status).toBe(404);
    expect((await ask({ startDate: '2026-11-02', endDate: '2026-11-02' })).status).toBe(404);
    expect((await ADJUST(req('POST', { employeeId: ana, policyId: vacation, hours: 999, note: 'free time' }))).status).toBe(404);
  });
});
