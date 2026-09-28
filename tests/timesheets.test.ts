import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { db } from '@/lib/db';
import { GET, PUT } from '@/app/api/timesheets/route';
import { POST as APPROVE } from '@/app/api/timesheets/approve/route';
import { GET as PAYROLL } from '@/app/api/payroll/export/route';

const RUN = `t${Date.now()}`;
const WEEK = '2026-09-27';
let org: string, app: string, recruiter: string, admin: string;
const as = (id: string) => { session.current = { user: { id, orgId: org } }; };
const put = (body: object) => PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ applicationId: app, week: WEEK, ...body }) }));
const approve = (action: string, ids?: string[]) => APPROVE(new Request('http://x', { method: 'POST', body: JSON.stringify({ week: WEEK, action, applicationIds: ids }) }));

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'T', slug: `t-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  const job = await db.job.create({ data: { organizationId: org, title: 'Picker', type: 'TEMP', payRate: 20, billRate: 30 } });
  const cand = await db.candidate.create({ data: { organizationId: org, name: 'Jo Worker', email: 'jo@x.test' } });
  app = (await db.application.create({ data: { organizationId: org, jobId: job.id, candidateId: cand.id, stage: 'PLACED', maxStage: 'PLACED' } })).id;
  const direct = await db.job.create({ data: { organizationId: org, title: 'Perm', type: 'DIRECT_HIRE' } });
  await db.application.create({ data: { organizationId: org, jobId: direct.id, candidateId: cand.id, stage: 'PLACED', maxStage: 'PLACED' } });
  for (const [role, set] of [['RECRUITER', (id: string) => (recruiter = id)], ['ADMIN', (id: string) => (admin = id)]] as const) {
    const u = await db.user.create({ data: { email: `${role}@${RUN}.test`, passwordHash: 'x' } });
    await db.membership.create({ data: { userId: u.id, organizationId: org, role } });
    set(u.id);
  }
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('timesheets', () => {
  it('lists assignments on non-direct-hire jobs with preview rates', async () => {
    as(recruiter);
    const { rows } = await (await GET(new Request(`http://x?week=${WEEK}`))).json();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ worker: 'Jo Worker', status: 'NOT_ENTERED', pay: 20, bill: 30, gross: 0 });
  });

  it('survives two saves racing to create the same week', async () => {
    as(recruiter);
    const [a, b] = await Promise.all([put({ regularHours: 40, overtimeHours: 0 }), put({ regularHours: 40, overtimeHours: 5 })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await db.timesheet.count({ where: { applicationId: app } })).toBe(1);
    await put({ regularHours: 40, overtimeHours: 5 });
    const { rows } = await (await GET(new Request(`http://x?week=${WEEK}`))).json();
    expect(rows[0]).toMatchObject({ status: 'DRAFT', reg: 40, ot: 5, gross: 40 * 20 + 5 * 30, billable: 40 * 30 + 5 * 45 });
  });

  it('rejects impossible hours and non-Sunday weeks with friendly messages', async () => {
    as(recruiter);
    expect((await (await put({ regularHours: 100, overtimeHours: 80 })).json()).error).toBe('More hours than exist in a week');
    const bad = await PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ applicationId: app, week: '2026-09-28', regularHours: 1, overtimeHours: 0 }) }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('Week ending must be a Sunday');
  });

  it('only admins approve; approved hours are locked until reopened', async () => {
    as(recruiter);
    expect((await approve('approve')).status).toBe(403);
    as(admin);
    expect(await (await approve('approve', [app])).json()).toEqual({ updated: 1 });
    as(recruiter);
    expect((await put({ regularHours: 10, overtimeHours: 0 })).status).toBe(409);
    as(admin);
    await approve('reopen', [app]);
    as(recruiter);
    expect((await put({ regularHours: 38, overtimeHours: 2 })).status).toBe(200);
    as(admin);
    await approve('approve');
  });

  it('exports approved hours to payroll CSV and marks them paid', async () => {
    as(admin);
    const csv = await (await PAYROLL(new Request(`http://x?week=${WEEK}`))).text();
    const [header, line] = csv.split('\n');
    expect(header.split(',').slice(6, 11)).toEqual(['Regular hours', 'Overtime hours', 'Regular rate', 'Overtime rate', 'Gross pay']);
    expect(line.split(',').slice(0, 11)).toEqual(['Jo Worker', 'Jo', 'Worker', 'jo@x.test', '', WEEK, '38.00', '2.00', '20.00', '30.00', '820.00']);
    expect(await (await approve('markPaid')).json()).toEqual({ updated: 1 });
    expect((await db.timesheet.findFirstOrThrow({ where: { applicationId: app } })).status).toBe('PAID');
  });
});
