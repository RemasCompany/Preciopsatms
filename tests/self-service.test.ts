import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const out = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; text: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: { to: string; subject: string; text: string }) => { out.emails.push(o); return { id: 'e1' }; }) }));
vi.mock('@/lib/sms', () => ({ sendSms: vi.fn(async () => ({ id: 's1' })) }));

import { db } from '@/lib/db';
import { POST as ADD_EMP } from '@/app/api/employees/route';
import { POST as SEND_PAGE } from '@/app/api/employees/[id]/portal/route';
import { POST as POLICY } from '@/app/api/time-off/policies/route';
import { POST as ADJUST } from '@/app/api/time-off/adjust/route';
import { GET as HUB } from '@/app/api/public/shifts/[token]/route';
import { POST as ACT } from '@/app/api/public/me/[token]/route';
import { GET as STUB } from '@/app/api/public/me/[token]/statement/route';
import { GET as DOC } from '@/app/api/public/me/[token]/document/route';
import { POST as END } from '@/app/api/employees/[id]/terminate/route';

const RUN = `ss${Date.now()}`;
let org: string, owner: string, ana: string, ben: string, anaCand: string, token: string, benToken: string, placedToken: string, vacation: string, runId: string, otherRun: string;
const as = (u: string) => { session.current = { user: { id: u, orgId: org } }; };
const req = (method: string, body?: object, url = 'http://x') => new Request(url, { method, body: body ? JSON.stringify(body) : undefined });
const t = (tok: string) => ({ params: { token: tok } });
const json = async (r: Response) => ({ status: r.status, body: await r.json() });
vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-14T15:00:00Z') });
afterAll(() => { vi.useRealTimers(); });

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Acme', slug: `acme-${RUN}`, plan: 'enterprise', subscriptionStatus: 'active', kind: 'EMPLOYER', timezone: 'America/Chicago' } })).id;
  owner = (await db.user.create({ data: { email: `owner@${RUN}.test`, name: 'Owner', passwordHash: 'x' } })).id;
  await db.membership.create({ data: { userId: owner, organizationId: org, role: 'OWNER' } });
  as(owner);
  const emp = async (o: object) => (await (await ADD_EMP(req('POST', { employmentType: 'FULL_TIME', startDate: '2025-01-06', payType: 'HOURLY', payRate: 20, ...o }))).json()).id;
  ana = await emp({ name: 'Ana Ruiz', title: 'Picker', email: 'ana@example.test', phone: '5125550101' });
  ben = await emp({ name: 'Ben Ode', title: 'Picker', email: 'ben@example.test' });
  anaCand = (await db.employee.findFirstOrThrow({ where: { id: ana } })).candidateId;
  vacation = (await (await POLICY(req('POST', { name: 'Vacation', method: 'ANNUAL', rate: 80 }))).json()).id;
  await ADJUST(req('POST', { employeeId: ana, policyId: vacation, hours: 40, note: 'Starting balance' }));
  // Ana and Ben get their employee page links (the token is in the email).
  for (const id of [ana, ben]) expect((await json(await SEND_PAGE(req('POST', { channels: ['email'] }), { params: { id } }))).body.sent).toEqual(['email']);
  const tok = (to: string) => out.emails.find((m) => m.to === to)!.text.match(/\/shifts\/([\w-]+)/)![1];
  token = tok('ana@example.test'); benToken = tok('ben@example.test');
  expect(out.emails[0].subject).toBe('Your employee page at Acme');
  // A placed (non-employee) worker with a link: no employee section.
  const c = await db.candidate.create({ data: { organizationId: org, name: 'Pat Placed', email: 'pat@example.test' } });
  const job = await db.job.create({ data: { organizationId: org, title: 'Temp', type: 'TEMP' } });
  await db.application.create({ data: { organizationId: org, candidateId: c.id, jobId: job.id, stage: 'PLACED' } });
  const { sendClockLink } = await import('@/lib/timeclock-server');
  const o = await db.organization.findFirstOrThrow({ where: { id: org } });
  await sendClockLink(o, (await db.user.findFirstOrThrow({ where: { id: owner } })), c.id, ['email']);
  placedToken = out.emails.find((m) => m.to === 'pat@example.test')!.text.match(/\/shifts\/([\w-]+)/)![1];
  // Pay: an approved run with Ana's week, and a draft run.
  const anaApp = (await db.employee.findFirstOrThrow({ where: { id: ana } })).applicationId!;
  const mkRun = async (number: string, status: 'APPROVED' | 'DRAFT') => {
    const r = await db.payrollRun.create({ data: { organizationId: org, number, frequency: 'WEEKLY', periodStart: new Date('2026-10-05T00:00:00Z'), periodEnd: new Date('2026-10-11T00:00:00Z'), payDate: new Date('2026-10-16T00:00:00Z'), status } });
    const ts = await db.timesheet.create({ data: { organizationId: org, applicationId: anaApp, weekEnding: new Date(number === 'PR-1' ? '2026-10-11T00:00:00Z' : '2026-10-04T00:00:00Z'), regularHours: 40, overtimeHours: 2, leaveHours: 8, payRate: 20, billRate: 0, status: 'APPROVED' } });
    await db.payrollItem.create({ data: { organizationId: org, runId: r.id, timesheetId: ts.id, applicationId: anaApp, candidateId: anaCand, workerName: 'Ana Ruiz', position: 'Picker', weekEnding: ts.weekEnding, regularHours: 40, overtimeHours: 2, payRate: 20, billRate: 0, regularPay: 800, overtimePay: 60, leaveHours: 8, leavePay: 160 } });
    return r.id;
  };
  runId = await mkRun('PR-1', 'APPROVED');
  otherRun = await mkRun('PR-2', 'DRAFT');
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('employee page', () => {
  it('shows an employee their job, balances and pay; placed workers get no employee section', async () => {
    const r = await json(await HUB(req('GET'), t(token)));
    expect(r.body.me.job).toMatchObject({ title: 'Picker', startDate: '2025-01-06', salaried: false });
    expect(r.body.me.timeOff.policies[0]).toMatchObject({ name: 'Vacation', balance: 40, pending: 0 });
    expect(r.body.me.stubs).toEqual([{ runId, number: 'PR-1', payDate: '2026-10-16', periodStart: '2026-10-05', periodEnd: '2026-10-11', hours: 50, gross: 1020, paid: false }]);
    expect((await json(await HUB(req('GET'), t(placedToken)))).body.me).toBeNull();
  });

  it('lets an employee ask for and withdraw their own time off, not anyone else’s', async () => {
    const ask = await json(await ACT(req('POST', { action: 'leave', policyId: vacation, startDate: '2026-10-26', endDate: '2026-10-27', hoursPerDay: 8, note: 'Wedding' }), t(token)));
    expect(ask).toEqual({ status: 200, body: { message: 'Sent. You asked for 16 hours over 2 days; you’ll see the answer here.' } });
    const reqRow = await db.leaveRequest.findFirstOrThrow({ where: { employeeId: ana } });
    expect([reqRow.status, reqRow.byEmployee, reqRow.createdById]).toEqual(['PENDING', true, null]);
    expect((await json(await ACT(req('POST', { action: 'leave', policyId: vacation, startDate: '2026-11-02', endDate: '2026-11-06', hoursPerDay: 8 }), t(token)))).body.error).toMatch(/only 24 vacation hours are available/);
    expect((await json(await ACT(req('POST', { action: 'cancelLeave', requestId: reqRow.id }), t(benToken)))).status).toBe(404);
    expect((await json(await ACT(req('POST', { action: 'cancelLeave', requestId: reqRow.id }), t(token)))).body.message).toBe('Request withdrawn.');
    expect((await json(await ACT(req('POST', { action: 'leave', policyId: vacation, startDate: '2026-10-26', endDate: '2026-10-26', hoursPerDay: 8 }), t(placedToken)))).status).toBe(404);
  });

  it('updates contact details, with validation', async () => {
    expect((await json(await ACT(req('POST', { action: 'profile', email: 'not-an-email' }), t(token)))).body.error).toBe('Enter a valid email address.');
    expect((await json(await ACT(req('POST', { action: 'profile', phone: '512-555-0199' }), t(token)))).status).toBe(200);
    expect((await db.candidate.findFirstOrThrow({ where: { id: anaCand } })).phone).toBe('512-555-0199');
  });

  it('serves only the employee’s own pay summaries from approved runs', async () => {
    const ok = await STUB(req('GET', undefined, `http://x/?run=${runId}`), t(token));
    expect([ok.status, ok.headers.get('content-type')]).toEqual([200, 'application/pdf']);
    expect((await STUB(req('GET', undefined, `http://x/?run=${otherRun}`), t(token))).status).toBe(404); // a draft run
    expect((await STUB(req('GET', undefined, `http://x/?run=${runId}`), t(benToken))).status).toBe(404); // not Ben's
    expect((await DOC(req('GET', undefined, 'http://x/?id=nope'), t(token))).status).toBe(404);
  });

  it('closes when employment ends', async () => {
    as(owner);
    await END(req('POST', { endDate: '2026-10-14', reason: 'Resigned' }), { params: { id: ana } });
    // Their private link is revoked: the whole page stops working.
    expect((await HUB(req('GET'), t(token))).status).toBe(404);
    expect((await json(await ACT(req('POST', { action: 'profile', phone: '1' }), t(token)))).status).toBe(404);
  });
});
