import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { db } from '@/lib/db';
import { businessDaysAfter, createBy, urgency } from '@/lib/everify';
import { PATCH as SETTINGS, POST as CREATE } from '@/app/api/everify/route';
import { PATCH as UPDATE } from '@/app/api/everify/[id]/route';
import { PATCH as MOVE } from '@/app/api/applications/[id]/route';

describe('E-Verify deadlines', () => {
  it('counts three business days after the start, skipping weekends', () => {
    expect(createBy('2026-09-28')).toBe('2026-10-01'); // Mon → Thu
    expect(createBy('2026-10-01')).toBe('2026-10-06'); // Thu → Tue
    expect(createBy('2026-10-03')).toBe('2026-10-07'); // Sat start → Wed
    expect(businessDaysAfter('2026-10-02', 1)).toBe('2026-10-05');
  });
  it('knows what needs attention', () => {
    expect(urgency({ status: 'to_create', dueDate: '2026-09-29' }, '2026-09-30')).toBe('overdue');
    expect(urgency({ status: 'to_create', dueDate: '2026-10-01' }, '2026-09-30')).toBe('due');
    expect(urgency({ status: 'to_create', dueDate: '2026-10-06' }, '2026-09-30')).toBe('ok');
    expect(urgency({ status: 'open', dueDate: '2026-09-01' }, '2026-09-30')).toBe('ok');
    expect(urgency({ status: 'authorized', dueDate: '2026-09-01' }, '2026-09-30')).toBe('done');
  });
});

const RUN = `ev${Date.now()}`;
let org: string, admin: string, rec: string, app: string, cand: string;
const as = (u: string) => { session.current = { user: { id: u, orgId: org } }; };
const req = (method: string, body?: object) => new Request('http://x', { method, body: body ? JSON.stringify(body) : undefined });

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'EV Staffing', slug: `e-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [admin, rec] = await Promise.all([u('admin'), u('rec')]);
  await db.membership.createMany({ data: [{ userId: admin, organizationId: org, role: 'ADMIN' }, { userId: rec, organizationId: org, role: 'RECRUITER' }] });
  const job = await db.job.create({ data: { organizationId: org, title: 'Picker', type: 'TEMP', openings: 5 } });
  cand = (await db.candidate.create({ data: { organizationId: org, name: 'Nia New' } })).id;
  app = (await db.application.create({ data: { organizationId: org, candidateId: cand, jobId: job.id, stage: 'OFFER' } })).id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('E-Verify cases', () => {
  it('open automatically on placement once an admin turns tracking on', async () => {
    as(rec);
    expect((await SETTINGS(req('PATCH', { enabled: true }))).status).toBe(403);
    as(admin);
    expect((await SETTINGS(req('PATCH', { enabled: true }))).status).toBe(200);
    as(rec);
    await MOVE(req('PATCH', { stage: 'PLACED' }), { params: { id: app } });
    const c = await db.eVerifyCase.findFirst({ where: { organizationId: org, candidateId: cand } });
    expect(c).toMatchObject({ status: 'to_create', applicationId: app });
    expect(c!.dueDate.toISOString().slice(0, 10)).toBe(createBy(c!.startDate.toISOString().slice(0, 10)));
    // Placing again (after moving back) doesn't open a second case while one is open.
    await MOVE(req('PATCH', { stage: 'OFFER' }), { params: { id: app } });
    await MOVE(req('PATCH', { stage: 'PLACED' }), { params: { id: app } });
    expect(await db.eVerifyCase.count({ where: { organizationId: org, candidateId: cand } })).toBe(1);
  });

  it('need a case number before moving on, then close', async () => {
    const c = (await db.eVerifyCase.findFirst({ where: { organizationId: org } }))!;
    expect((await (await UPDATE(req('PATCH', { status: 'open' }), { params: { id: c.id } })).json()).error).toBe('Enter the E-Verify case number first.');
    expect((await UPDATE(req('PATCH', { status: 'open', caseNumber: '2026123456789AB' }), { params: { id: c.id } })).status).toBe(200);
    expect((await UPDATE(req('PATCH', { status: 'authorized' }), { params: { id: c.id } })).status).toBe(200);
    const done = await db.eVerifyCase.findUnique({ where: { id: c.id } });
    expect(done).toMatchObject({ status: 'authorized', caseNumber: '2026123456789AB' });
    expect(done!.closedAt).not.toBeNull();
    expect((await (await UPDATE(req('PATCH', { status: 'maybe' }), { params: { id: c.id } })).json()).error).toBe('Choose a status.');
  });

  it('can be added by hand, with the deadline from the start date', async () => {
    const r = await CREATE(req('POST', { candidateId: cand, startDate: '2026-10-01' }));
    expect(r.status).toBe(201);
    const c = await db.eVerifyCase.findUnique({ where: { id: (await r.json()).id } });
    expect(c!.dueDate.toISOString().slice(0, 10)).toBe('2026-10-06');
  });
});
