import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ id: 'e1' })) }));
vi.mock('@/lib/sms', () => ({ sendSms: vi.fn(async () => ({ id: 's1' })) }));

import { db } from '@/lib/db';
import { hasFeature, planView, priceIdFor } from '@/lib/plans';
import { stageLabel } from '@/lib/pipeline';
import { fieldsFor } from '@/lib/records';
import { GET as LIST, POST as ADD } from '@/app/api/employees/route';
import { GET as ONE, PATCH as EDIT } from '@/app/api/employees/[id]/route';
import { POST as PAY } from '@/app/api/employees/[id]/pay/route';
import { POST as END } from '@/app/api/employees/[id]/terminate/route';
import { POST as DEPT } from '@/app/api/departments/route';
import { DELETE as DEPT_DEL } from '@/app/api/departments/[id]/route';
import { PATCH as ORG_TYPE } from '@/app/api/org/type/route';
import { PATCH as MOVE } from '@/app/api/applications/[id]/route';
import { POST as SHIFT } from '@/app/api/shifts/route';
import { PUT as TIMESHEET } from '@/app/api/timesheets/route';
import { GET as RECORDS } from '@/app/api/records/[kind]/route';
import { runPeopleDaily } from '@/lib/people';
import { timesheetRows } from '@/lib/timesheets';
import { tenantDb } from '@/lib/tenant';

const RUN = `pp${Date.now()}`;
let org: string, agency: string, other: string, owner: string, hr: string, viewer: string, agencyOwner: string, outsider: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const req = (method: string, body?: object) => new Request('http://x', { method, body: body ? JSON.stringify(body) : undefined });
const p = (id: string) => ({ params: { id } });
vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-14T15:00:00Z') });
afterAll(() => { vi.useRealTimers(); });
const add = async (o: object) => { const r = await ADD(req('POST', { email: '', employmentType: 'FULL_TIME', startDate: '2026-01-05', payType: 'HOURLY', payRate: 20, ...o })); return { status: r.status, body: await r.json() }; };

beforeAll(async () => {
  const mk = (n: string, kind: 'STAFFING' | 'EMPLOYER') => db.organization.create({ data: { name: n, slug: `${n.toLowerCase()}-${RUN}`, plan: 'enterprise', subscriptionStatus: 'active', kind, timezone: 'America/Chicago' } }).then((o) => o.id);
  [org, agency, other] = await Promise.all([mk('Acme', 'EMPLOYER'), mk('Agency', 'STAFFING'), mk('Other', 'EMPLOYER')]);
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [owner, hr, viewer, agencyOwner, outsider] = await Promise.all([u('owner'), u('hr'), u('viewer'), u('agencyowner'), u('outsider')]);
  await db.membership.createMany({ data: [
    { userId: owner, organizationId: org, role: 'OWNER' }, { userId: hr, organizationId: org, role: 'RECRUITER' }, { userId: viewer, organizationId: org, role: 'VIEWER' },
    { userId: agencyOwner, organizationId: agency, role: 'OWNER' }, { userId: outsider, organizationId: other, role: 'OWNER' },
  ] });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('company type', () => {
  const base = { plan: 'enterprise' as const, subscriptionStatus: 'active' };
  it('hides staffing-only features from employers and gives them employee records', () => {
    const employer = { ...base, kind: 'EMPLOYER' as const };
    for (const f of ['crm', 'leads', 'vendors', 'clientPortal', 'invoicing'] as const) expect(hasFeature(employer, f)).toBe(false);
    for (const f of ['ats', 'scheduling', 'timesheets', 'payrollRuns', 'people', 'training'] as const) expect(hasFeature(employer, f)).toBe(true);
    expect(hasFeature({ ...base, kind: 'STAFFING' }, 'people')).toBe(false);
    expect(hasFeature({ ...base, kind: 'STAFFING', hrEnabled: true }, 'people')).toBe(true);
    expect(hasFeature({ ...base, kind: 'STAFFING' }, 'invoicing')).toBe(true);
  });
  it('prices employers per employee and renames their stages and job fields', () => {
    expect(planView('growth', 'EMPLOYER').displayPrice).toMatch(/employee/);
    expect(planView('growth', 'STAFFING').displayPrice).toBe('$79/user/mo · 2-user minimum');
    process.env.STRIPE_PRICE_GROWTH_EMPLOYER = 'price_emp_growth';
    expect(priceIdFor('growth', 'EMPLOYER')).toBe('price_emp_growth');
    expect([stageLabel('PLACED', 'EMPLOYER'), stageLabel('SUBMITTED', 'EMPLOYER'), stageLabel('PLACED')]).toEqual(['Hired', 'Hiring manager', 'Placed']);
    const keys = fieldsFor('jobs', 'EMPLOYER').map((f) => f.key);
    expect(keys).not.toContain('clientId'); expect(keys).not.toContain('billRate');
    expect(fieldsFor('jobs', 'EMPLOYER').find((f) => f.key === 'type')!.options![0]).toEqual(['FULL_TIME', 'Full-time']);
  });
  it('keeps employers out of client pages and agencies out of employees until they turn them on', async () => {
    as(owner);
    const r = await RECORDS(req('GET'), { params: { kind: 'clients' } } as never);
    expect([r.status, (await r.json()).error]).toEqual([403, 'That’s a staffing-agency feature. Your company is set up as an employer (Settings & data).']);
    as(agencyOwner, agency);
    const a = await LIST(req('GET'));
    expect([a.status, (await a.json()).error]).toEqual([403, 'Employee records are turned off. An admin can turn them on in Settings & data.']);
    expect((await ORG_TYPE(req('PATCH', { kind: 'STAFFING', hrEnabled: true }))).status).toBe(200);
    expect((await LIST(req('GET'))).status).toBe(200);
    as(hr);
    expect((await ORG_TYPE(req('PATCH', { kind: 'STAFFING' }))).status).toBe(403);
  });
});

let ana: string, ben: string, cy: string;
describe('employees', () => {
  it('adds employees with a position that scheduling and timesheets can use', async () => {
    as(owner);
    const d = await (await DEPT(req('POST', { name: 'Warehouse' }))).json();
    const r = await add({ name: 'Ana Ruiz', title: 'Shift Lead', departmentId: d.id, payRate: 24 });
    expect(r.status).toBe(201);
    ana = r.body.id;
    ben = (await add({ name: 'Ben Ode', title: 'Picker', managerId: ana, departmentId: d.id })).body.id;
    cy = (await add({ name: 'Cy Park', title: 'Office Manager', payType: 'SALARY', payRate: 62000, managerId: ana })).body.id;
    const e = await db.employee.findFirstOrThrow({ where: { id: ben }, include: { application: { include: { job: true } } } });
    expect(e.application).toMatchObject({ stage: 'PLACED', job: { title: 'Picker', type: 'FULL_TIME', publish: false, clientId: null } });
    expect(e.organizationId).toBe(org);
    // A second picker shares the position.
    const ed = (await add({ name: 'Ed Moe', title: 'picker' })).body.id;
    const e2 = await db.employee.findFirstOrThrow({ where: { id: ed }, include: { application: true } });
    expect(e2.application!.jobId).toBe(e.application!.jobId);
    expect((await add({ name: '', title: 'Picker' })).body.error).toBe('Enter the employee’s name.');
    const s = await SHIFT(req('POST', { applicationId: e.applicationId, dates: ['2026-10-19'], start: '07:00', end: '15:30', breakMinutes: 30 }));
    expect(s.status).toBe(201);
  });

  it('shows pay to owners and admins only, and lets only them add people or change pay', async () => {
    as(hr);
    const rows = await (await LIST(req('GET'))).json();
    expect(rows.find((x: { id: string }) => x.id === ana)).toMatchObject({ name: 'Ana Ruiz', payRate: null, payType: null });
    expect((await ONE(req('GET'), p(ana)).then((r) => r.json())).pay).toBeNull();
    expect((await add({ name: 'X', title: 'Y' })).status).toBe(403);
    expect((await PAY(req('POST', { effectiveDate: '2026-10-14', payType: 'HOURLY', payRate: 30, reason: 'Raise' }), p(ana))).status).toBe(403);
    expect((await EDIT(req('PATCH', { title: 'Senior Picker' }), p(ben))).status).toBe(200);
    as(viewer);
    expect((await EDIT(req('PATCH', { title: 'Nope' }), p(ben))).status).toBe(403);
    as(owner);
    const one = await (await ONE(req('GET'), p(ana))).json();
    expect(one.employee.payRate).toBe(24);
    expect(one.reports.map((r: { name: string }) => r.name).sort()).toEqual(['Ben Ode', 'Cy Park']);
    expect(one.pay[0]).toMatchObject({ payRate: 24, reason: 'Hired', title: 'Shift Lead' });
  });

  it('refuses a manager loop', async () => {
    as(owner);
    const r = await EDIT(req('PATCH', { managerId: ben }), p(ana));
    expect([r.status, (await r.json()).error]).toEqual([400, 'That would make a loop: they already report to this person.']);
    expect((await EDIT(req('PATCH', { managerId: ana }), p(ana))).status).toBe(400);
  });

  it('applies a raise now, or on its date when it is in the future', async () => {
    as(owner);
    const now = await PAY(req('POST', { effectiveDate: '2026-10-14', payType: 'HOURLY', payRate: 26, reason: 'Annual raise' }), p(ana));
    expect(await now.json()).toEqual({ applied: true });
    const later = await PAY(req('POST', { effectiveDate: '2026-11-01', payType: 'HOURLY', payRate: 28.5, title: 'Supervisor', reason: 'Promotion' }), p(ana));
    expect(await later.json()).toEqual({ applied: false });
    expect(Number((await db.employee.findFirstOrThrow({ where: { id: ana } })).payRate)).toBe(26);
    vi.setSystemTime(new Date('2026-11-01T15:00:00Z'));
    expect((await runPeopleDaily()).pay).toBeGreaterThanOrEqual(1);
    const e = await db.employee.findFirstOrThrow({ where: { id: ana }, include: { application: { include: { job: true } } } });
    expect([Number(e.payRate), e.title, e.application!.job.title]).toEqual([28.5, 'Supervisor', 'Supervisor']);
    vi.setSystemTime(new Date('2026-10-14T15:00:00Z'));
  });

  it('pays hourly employees their own rate and leaves salaried ones off timesheets', async () => {
    as(owner);
    const week = new Date('2026-10-18T00:00:00Z');
    const rows = await timesheetRows(tenantDb(org), week);
    expect(rows.map((r) => r.worker)).not.toContain('Cy Park');
    expect(rows.find((r) => r.worker === 'Ana Ruiz')!.pay).toBe(28.5); // after the promotion above
    const cyApp = (await db.employee.findFirstOrThrow({ where: { id: cy } })).applicationId;
    const t = await TIMESHEET(req('PUT', { applicationId: cyApp, week: '2026-10-18', regularHours: 40, overtimeHours: 0 }));
    expect([t.status, (await t.json()).error]).toEqual([409, 'Salaried employees are paid their salary, not from timesheets.']);
    const benApp = (await db.employee.findFirstOrThrow({ where: { id: ben } })).applicationId;
    expect((await TIMESHEET(req('PUT', { applicationId: benApp, week: '2026-10-18', regularHours: 40, overtimeHours: 2 }))).status).toBeLessThan(300);
    expect(Number((await db.timesheet.findFirstOrThrow({ where: { applicationId: benApp! } })).payRate)).toBe(20);
  });

  it('ends employment: later shifts come off, reports move up, and they leave the schedule', async () => {
    as(owner);
    const e = await db.employee.findFirstOrThrow({ where: { id: ben } });
    await db.shift.create({ data: { organizationId: org, applicationId: e.applicationId!, date: new Date('2026-10-20T00:00:00Z'), start: '07:00', end: '15:30', notified: true, notifiedAt: new Date() } });
    const kid = (await add({ name: 'Dee Kid', title: 'Picker', managerId: ben })).body.id;
    const r = await END(req('POST', { endDate: '2026-10-14', reason: 'Resigned', rehire: false }), p(ben));
    expect(await r.json()).toEqual({ removedShifts: 2, effective: true });
    expect(await db.shift.count({ where: { applicationId: e.applicationId!, cancelled: false } })).toBe(0);
    expect(await db.shift.count({ where: { applicationId: e.applicationId!, cancelled: true } })).toBe(1); // the sent one goes out as a cancellation
    expect((await db.employee.findFirstOrThrow({ where: { id: kid } })).managerId).toBe(ana);
    expect(await db.doNotReturn.count({ where: { candidateId: e.candidateId, clientId: null } })).toBe(1);
    const s = await SHIFT(req('POST', { applicationId: e.applicationId, dates: ['2026-10-21'], start: '07:00', end: '15:30', breakMinutes: 30 }));
    expect(s.status).toBe(404);
    const current = await (await LIST(req('GET'))).json();
    expect(current.map((x: { name: string }) => x.name)).not.toContain('Ben Ode');
    expect((await EDIT(req('PATCH', { status: 'ACTIVE' }), p(ben))).status).toBe(409);
  });

  it('a future last day takes effect on that day', async () => {
    as(owner);
    const r = await END(req('POST', { endDate: '2026-10-31', reason: 'End of season or contract', rehire: true }), p(cy));
    expect((await r.json()).effective).toBe(false);
    expect((await db.employee.findFirstOrThrow({ where: { id: cy } })).status).toBe('ACTIVE');
    vi.setSystemTime(new Date('2026-10-31T18:00:00Z'));
    expect((await runPeopleDaily()).ended).toBeGreaterThanOrEqual(1);
    expect((await db.employee.findFirstOrThrow({ where: { id: cy } })).status).toBe('TERMINATED');
    vi.setSystemTime(new Date('2026-10-14T15:00:00Z'));
  });

  it('hiring through the pipeline adds the employee', async () => {
    as(owner);
    const job = await db.job.create({ data: { organizationId: org, title: 'Forklift Driver', type: 'DIRECT_HIRE', payRate: 21 } });
    const cand = await db.candidate.create({ data: { organizationId: org, name: 'Fay Hire' } });
    const app = await db.application.create({ data: { organizationId: org, candidateId: cand.id, jobId: job.id, stage: 'OFFER' } });
    expect((await MOVE(req('PATCH', { stage: 'PLACED' }), p(app.id))).status).toBe(200);
    const e = await db.employee.findFirstOrThrow({ where: { candidateId: cand.id } });
    expect([e.title, e.employmentType, Number(e.payRate), e.applicationId]).toEqual(['Forklift Driver', 'FULL_TIME', 21, app.id]);
    expect((await db.job.findFirstOrThrow({ where: { id: job.id } })).type).toBe('FULL_TIME');
    expect((await db.candidate.findFirstOrThrow({ where: { id: cand.id } })).status).toBe('Employee');
  });

  it('deleting a department leaves its people without one', async () => {
    as(owner);
    const d = await db.department.findFirstOrThrow({ where: { organizationId: org, name: 'Warehouse' } });
    const r = await DEPT_DEL(req('DELETE'), p(d.id));
    expect((await r.json()).moved).toBeGreaterThanOrEqual(1);
    expect(await db.employee.count({ where: { departmentId: d.id } })).toBe(0);
  });

  it('never shows or changes another company’s employees', async () => {
    as(outsider, other);
    expect((await ONE(req('GET'), p(ana))).status).toBe(404);
    expect((await EDIT(req('PATCH', { title: 'Hacked' }), p(ana))).status).toBe(404);
    expect((await PAY(req('POST', { effectiveDate: '2026-10-14', payType: 'HOURLY', payRate: 1, reason: 'x x' }), p(ana))).status).toBe(404);
    expect((await END(req('POST', { endDate: '2026-10-14', reason: 'Resigned' }), p(ana))).status).toBe(404);
    expect(await (await LIST(req('GET'))).json()).toEqual([]);
    expect((await add({ name: 'Mine', title: 'T', managerId: ana })).status).toBe(404);
    expect((await db.employee.findFirstOrThrow({ where: { id: ana } })).title).toBe('Supervisor');
  });
});
