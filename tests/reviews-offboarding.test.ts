import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const out = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; text: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: { to: string; subject: string; text: string }) => { out.emails.push(o); return { id: 'e1' }; }) }));
vi.mock('@/lib/sms', () => ({ sendSms: vi.fn(async () => ({ id: 's1' })) }));

import { db } from '@/lib/db';
import { finalPayRule } from '@/lib/offboarding';
import { POST as ADD_EMP } from '@/app/api/employees/route';
import { POST as SEND_PAGE } from '@/app/api/employees/[id]/portal/route';
import { POST as END } from '@/app/api/employees/[id]/terminate/route';
import { POST as DEPT } from '@/app/api/departments/route';
import { POST as CYCLE } from '@/app/api/reviews/cycles/route';
import { PATCH as CYCLE_EDIT } from '@/app/api/reviews/cycles/[id]/route';
import { GET as REVIEW, PUT as MGR, POST as SHARE } from '@/app/api/reviews/[id]/route';
import { POST as GOAL } from '@/app/api/goals/route';
import { GET as HUB } from '@/app/api/public/shifts/[token]/route';
import { POST as ACT } from '@/app/api/public/me/[token]/route';
import { POST as ADD_TASK } from '@/app/api/offboarding/[employeeId]/route';
import { PATCH as TASK } from '@/app/api/offboarding/tasks/[id]/route';
import { PUT as TEMPLATE } from '@/app/api/offboarding/template/route';
import { POST as POLICY } from '@/app/api/time-off/policies/route';
import { POST as ADJUST } from '@/app/api/time-off/adjust/route';

const RUN = `ro${Date.now()}`;
let org: string, other: string, owner: string, hr: string, viewer: string, outsider: string;
let ana: string, ben: string, cy: string, token: string, benToken: string, cycleId: string, anaReview: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const req = (method: string, body?: object) => new Request('http://x', { method, body: body ? JSON.stringify(body) : undefined });
const p = (id: string) => ({ params: { id } });
const json = async (r: Response) => ({ status: r.status, body: await r.json() });
const all = { q1: { rating: 4 }, q2: { rating: 5 }, q3: { rating: 3 }, q4: { rating: 4 }, q5: { text: 'Trained two new pickers.' }, q6: { text: 'Faster cycle counts.' } };
vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-14T15:00:00Z') });
afterAll(() => { vi.useRealTimers(); });

beforeAll(async () => {
  const mk = (n: string) => db.organization.create({ data: { name: n, slug: `${n.toLowerCase()}-${RUN}`, plan: 'growth', subscriptionStatus: 'active', kind: 'EMPLOYER', timezone: 'America/Chicago' } }).then((o) => o.id);
  [org, other] = await Promise.all([mk('Acme'), mk('Other')]);
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [owner, hr, viewer, outsider] = await Promise.all([u('owner'), u('hr'), u('viewer'), u('outsider')]);
  await db.membership.createMany({ data: [{ userId: owner, organizationId: org, role: 'OWNER' }, { userId: hr, organizationId: org, role: 'RECRUITER' }, { userId: viewer, organizationId: org, role: 'VIEWER' }, { userId: outsider, organizationId: other, role: 'OWNER' }] });
  as(owner);
  const wh = (await (await DEPT(req('POST', { name: 'Warehouse' }))).json()).id;
  const emp = async (o: object) => (await (await ADD_EMP(req('POST', { employmentType: 'FULL_TIME', startDate: '2025-01-06', payType: 'HOURLY', payRate: 20, ...o }))).json()).id;
  ana = await emp({ name: 'Ana Ruiz', title: 'Picker', email: 'ana@example.test', departmentId: wh });
  ben = await emp({ name: 'Ben Ode', title: 'Clerk', email: 'ben@example.test' });
  cy = await emp({ name: 'Cy New', title: 'Picker', startDate: '2027-01-04', departmentId: wh }); // starts after the period
  // Cy's job is in Los Angeles, for the final-pay rule.
  const cyApp = (await db.employee.findFirstOrThrow({ where: { id: cy } })).applicationId!;
  const app = await db.application.findFirstOrThrow({ where: { id: cyApp } });
  await db.job.update({ where: { id: app.jobId }, data: { location: 'Los Angeles, CA' } });
  for (const id of [ana, ben]) await SEND_PAGE(req('POST', { channels: ['email'] }), p(id));
  const tok = (to: string) => out.emails.find((m) => m.to === to)!.text.match(/\/shifts\/([\w-]+)/)![1];
  token = tok('ana@example.test'); benToken = tok('ben@example.test');
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('reviews', () => {
  it('starts a cycle for current employees who started in the period', async () => {
    as(hr);
    expect((await CYCLE(req('POST', { name: 'X', periodStart: '2026-01-01', periodEnd: '2026-12-31', dueDate: '2026-11-15' }))).status).toBe(403);
    as(owner);
    expect((await json(await CYCLE(req('POST', { name: '2026 review', periodStart: '2026-12-31', periodEnd: '2026-01-01', dueDate: '2026-11-15' })))).body.error).toBe('The period ends before it starts.');
    const r = await json(await CYCLE(req('POST', { name: '2026 review', periodStart: '2026-01-01', periodEnd: '2026-12-31', dueDate: '2026-11-15' })));
    expect(r).toMatchObject({ status: 201, body: { added: 2 } });
    cycleId = r.body.id;
    expect((await json(await CYCLE_EDIT(req('PATCH', { addMissing: true }), p(cycleId)))).body.added).toBe(0);
    anaReview = (await db.review.findFirstOrThrow({ where: { cycleId, employeeId: ana } })).id;
  });

  it('employees save and submit their self review; drafts stay private', async () => {
    const hub = await json(await HUB(req('GET'), { params: { token } }));
    expect(hub.body.me.reviews[0]).toMatchObject({ id: anaReview, cycle: '2026 review', canSelf: true, shared: null });
    expect((await json(await ACT(req('POST', { action: 'selfReview', reviewId: anaReview, answers: { q1: { rating: 4 } } }), { params: { token } }))).body.message).toMatch(/Saved/);
    as(hr);
    expect((await json(await REVIEW(req('GET'), p(anaReview)))).body.self).toBeNull();
    expect((await json(await ACT(req('POST', { action: 'selfReview', reviewId: anaReview, answers: { q1: { rating: 4 } }, submit: true }), { params: { token } }))).body.error).toBe('Answer “Reliability and attendance” before submitting.');
    expect((await json(await ACT(req('POST', { action: 'selfReview', reviewId: anaReview, answers: all, submit: true }), { params: { token } }))).status).toBe(200);
    expect((await json(await ACT(req('POST', { action: 'selfReview', reviewId: anaReview, answers: all, submit: true }), { params: { token: benToken } }))).status).toBe(404);
    expect((await json(await REVIEW(req('GET'), p(anaReview)))).body.self.q5).toEqual({ text: 'Trained two new pickers.' });
    as(viewer);
    expect((await REVIEW(req('GET'), p(anaReview))).status).toBe(403);
  });

  it('the manager review needs every answer and a rating, then is shared and acknowledged', async () => {
    as(hr);
    expect((await json(await SHARE(req('POST'), p(anaReview)))).body.error).toBe('Submit the manager review before sharing it.');
    expect((await json(await MGR(req('PUT', { answers: all, submit: true }), p(anaReview)))).body.error).toBe('Choose an overall rating before submitting.');
    expect((await json(await MGR(req('PUT', { answers: all, rating: 4, summary: 'A strong year.', submit: true }), p(anaReview)))).status).toBe(200);
    // Not visible to the employee until shared.
    expect((await json(await HUB(req('GET'), { params: { token } }))).body.me.reviews[0].shared).toBeNull();
    expect((await SHARE(req('POST'), p(anaReview))).status).toBe(200);
    expect((await json(await MGR(req('PUT', { answers: all, rating: 2 }), p(anaReview)))).body.error).toBe('This review was already shared with the employee.');
    const seen = (await json(await HUB(req('GET'), { params: { token } }))).body.me.reviews[0].shared;
    expect(seen).toMatchObject({ rating: 4, summary: 'A strong year.', acknowledged: false });
    await ACT(req('POST', { action: 'acknowledge', reviewId: anaReview, comment: 'Thanks!' }), { params: { token } });
    expect((await db.review.findFirstOrThrow({ where: { id: anaReview } })).employeeComment).toBe('Thanks!');
  });

  it('goals: HR sets them, the employee updates their own', async () => {
    as(hr);
    const g = (await json(await GOAL(req('POST', { employeeId: ana, title: 'Reach truck certification', dueDate: '2027-03-31' })))).body.id;
    expect((await json(await ACT(req('POST', { action: 'goal', goalId: g, progress: 50 }), { params: { token: benToken } }))).status).toBe(404);
    expect((await json(await ACT(req('POST', { action: 'goal', goalId: g, progress: 100 }), { params: { token } }))).body.message).toMatch(/done/);
    expect((await db.goal.findFirstOrThrow({ where: { id: g } })).status).toBe('DONE');
  });

  it('a closed cycle can’t be changed', async () => {
    as(owner);
    await CYCLE_EDIT(req('PATCH', { status: 'CLOSED' }), p(cycleId));
    const benReview = (await db.review.findFirstOrThrow({ where: { cycleId, employeeId: ben } })).id;
    expect((await json(await ACT(req('POST', { action: 'selfReview', reviewId: benReview, answers: all, submit: true }), { params: { token: benToken } }))).body.error).toBe('This review cycle is closed.');
    expect((await json(await MGR(req('PUT', { answers: all }), p(benReview)))).status).toBe(409);
  });
});

describe('offboarding', () => {
  it('knows the final-paycheck rule for several states', () => {
    expect(finalPayRule('Los Angeles, CA', '2026-10-20', 'Laid off').due).toBe('2026-10-20');
    expect(finalPayRule('Los Angeles, CA', '2026-10-20', 'Resigned').due).toBe('2026-10-23');
    expect(finalPayRule('Austin, TX', '2026-10-20', 'Terminated for cause').due).toBe('2026-10-26');
    expect(finalPayRule('Boise, ID', '2026-10-20', 'Resigned')).toEqual({ due: '2026-10-27', text: expect.stringMatching(/next regular payday/) });
  });

  it('ending employment builds the checklist, with the state rule and time-off balance', async () => {
    as(owner);
    const vac = (await json(await POLICY(req('POST', { name: 'Vacation', method: 'ANNUAL', rate: 80 })))).body.id;
    await ADJUST(req('POST', { employeeId: cy, policyId: vac, hours: 12, note: 'Starting balance' }));
    await db.employee.update({ where: { id: cy }, data: { startDate: new Date('2026-06-01T00:00:00Z') } }); // started after the review period was set up
    expect((await END(req('POST', { endDate: '2026-10-20', reason: 'Laid off' }), p(cy))).status).toBe(200);
    const tasks = await db.offboardingTask.findMany({ where: { employeeId: cy }, orderBy: { sort: 'asc' } });
    expect(tasks.length).toBe(7);
    expect([tasks[0].title, tasks[0].dueDate!.toISOString().slice(0, 10)]).toEqual(['Final paycheck', '2026-10-20']);
    expect(tasks[0].note).toMatch(/^California: the final paycheck is due on the last day/);
    expect(tasks.find((t) => t.title.startsWith('Settle time-off'))!.note).toBe('Vacation: 12 hours left');
    expect(tasks.find((t) => t.title === 'Exit interview')!.dueDate!.toISOString().slice(0, 10)).toBe('2026-10-19');
  });

  it('tasks can be ticked off, noted and added; the template is the company’s own', async () => {
    as(hr);
    const t = await db.offboardingTask.findFirstOrThrow({ where: { employeeId: cy, title: 'Exit interview' } });
    await TASK(req('PATCH', { done: true, note: 'Moving out of state.' }), p(t.id));
    expect(await db.offboardingTask.findFirstOrThrow({ where: { id: t.id } })).toMatchObject({ note: 'Moving out of state.', doneById: hr });
    expect((await ADD_TASK(req('POST', { title: 'Collect forklift key' }), { params: { employeeId: cy } })).status).toBe(201);
    expect((await TEMPLATE(req('PUT', { items: [{ title: 'Return laptop', days: 0 }] }))).status).toBe(403);
    as(owner);
    expect((await TEMPLATE(req('PUT', { items: [{ title: 'Final paycheck', owner: 'Payroll', days: 0, finalPay: true }, { title: 'Return laptop', owner: 'IT', days: 1 }] }))).status).toBe(200);
    await END(req('POST', { endDate: '2026-10-16', reason: 'Resigned' }), p(ben));
    expect((await db.offboardingTask.findMany({ where: { employeeId: ben }, orderBy: { sort: 'asc' } })).map((x) => x.title)).toEqual(['Final paycheck', 'Return laptop']);
    expect((await TEMPLATE(req('PUT', { items: [] }))).status).toBe(200);
    expect((await db.organization.findFirstOrThrow({ where: { id: org } })).offboardingTemplate).toBeNull();
  });

  it('keeps every company’s reviews and checklists to itself', async () => {
    as(outsider, other);
    const t = await db.offboardingTask.findFirstOrThrow({ where: { employeeId: cy } });
    expect((await TASK(req('PATCH', { done: true }), p(t.id))).status).toBe(404);
    expect((await ADD_TASK(req('POST', { title: 'x' }), { params: { employeeId: cy } })).status).toBe(404);
    expect((await REVIEW(req('GET'), p(anaReview))).status).toBe(404);
    expect((await SHARE(req('POST'), p(anaReview))).status).toBe(404);
    expect((await GOAL(req('POST', { employeeId: ana, title: 'Hack' }))).status).toBe(404);
  });
});
