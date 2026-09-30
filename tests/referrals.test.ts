import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { db } from '@/lib/db';
import { newToken, sha256 } from '@/lib/tokens';
import { POST as REFER } from '@/app/api/public/referrals/[token]/route';
import { GET as PAGE } from '@/app/api/public/shifts/[token]/route';
import { PATCH as DECIDE } from '@/app/api/referrals/[id]/route';
import { PATCH as SETTINGS } from '@/app/api/referrals/settings/route';
import { POST as STAFF_REFER } from '@/app/api/referrals/route';

const RUN = `rf${Date.now()}`;
let org: string, admin: string, rec: string, worker: string, job: string, token: string;
const as = (u: string) => { session.current = { user: { id: u, orgId: org } }; };
const req = (method: string, body?: object) => new Request('http://x', { method, headers: { 'x-forwarded-for': '4.4.4.4' }, body: body ? JSON.stringify(body) : undefined });
const T = { params: { token: '' } };

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Ref Staffing', slug: `r-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [admin, rec] = await Promise.all([u('admin'), u('rec')]);
  await db.membership.createMany({ data: [{ userId: admin, organizationId: org, role: 'ADMIN' }, { userId: rec, organizationId: org, role: 'RECRUITER' }] });
  job = (await db.job.create({ data: { organizationId: org, title: 'Packer', type: 'TEMP', status: 'OPEN', publish: true } })).id;
  worker = (await db.candidate.create({ data: { organizationId: org, name: 'Wes Worker', phone: '4075550100', email: 'wes@w.test' } })).id;
  await db.candidate.create({ data: { organizationId: org, name: 'Already Here', phone: '(407) 555-0199' } });
  token = newToken(); T.params.token = token;
  await db.workerLink.create({ data: { organizationId: org, candidateId: worker, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 864e5) } });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('referrals', () => {
  let refId: string, friend: string;
  it('admins set a bonus that workers see', async () => {
    as(rec);
    expect((await SETTINGS(req('PATCH', { bonus: 100, minHours: 40 }))).status).toBe(403);
    as(admin);
    expect((await SETTINGS(req('PATCH', { bonus: 100, minHours: 40 }))).status).toBe(200);
    const page = await (await PAGE(req('GET'), T)).json();
    expect(page.referrals).toMatchObject({ bonus: 100, minHours: 40, jobs: [{ id: job, label: 'Packer' }], mine: [] });
  });

  it('workers refer friends, who become candidates on the job; duplicates and self-referrals are refused', async () => {
    expect((await (await REFER(req('POST', { name: 'Fay Friend' }), T)).json()).error).toBe('Add a phone number or email so we can reach them.');
    expect((await (await REFER(req('POST', { name: 'Me Again', phone: '407-555-0100' }), T)).json()).error).toBe('That’s your own contact info — refer someone else!');
    expect((await (await REFER(req('POST', { name: 'Al Here', phone: '407.555.0199' }), T)).json()).error).toBe('Thanks! Al is already in our system, so this one can’t count as a referral.');
    const r = await REFER(req('POST', { name: 'Fay Friend', phone: '407 555 0123', jobId: job, note: 'Has a forklift card' }), T);
    const rj = await r.json();
    expect(rj.message).toBe('Thanks for referring Fay! We’ll reach out to them — and let you know when your bonus is on its way.');
    const c = await db.candidate.findFirst({ where: { organizationId: org, name: 'Fay Friend' }, include: { applications: true } });
    expect(c).toMatchObject({ source: 'Referral', phone: '4075550123' });
    expect(c!.applications).toEqual([expect.objectContaining({ jobId: job, stage: 'APPLIED' })]);
    friend = c!.id;
    const ref = await db.referral.findFirst({ where: { organizationId: org } });
    expect(ref).toMatchObject({ referrerId: worker, candidateId: friend });
    expect([Number(ref!.bonus), ref!.minHours]).toEqual([100, 40]);
    refId = ref!.id;
    expect((await (await PAGE(req('GET'), T)).json()).referrals.mine).toEqual([{ id: refId, name: 'Fay', status: 'Received' }]);
  });

  it('the bonus comes due after enough approved hours, and is paid once', async () => {
    as(admin);
    expect((await (await DECIDE(req('PATCH', { action: 'paid' }), { params: { id: refId } })).json()).error).toBe('Fay Friend has worked 0 of 40 hours — the bonus isn’t due yet.');
    const app = await db.application.findFirst({ where: { candidateId: friend } });
    await db.timesheet.create({ data: { organizationId: org, applicationId: app!.id, weekEnding: new Date('2026-09-20'), regularHours: 30, overtimeHours: 0, payRate: 15, billRate: 22, status: 'APPROVED' } });
    expect((await (await PAGE(req('GET'), T)).json()).referrals.mine[0].status).toBe('Working — 30 of 40 hours');
    await db.timesheet.create({ data: { organizationId: org, applicationId: app!.id, weekEnding: new Date('2026-09-27'), regularHours: 10, overtimeHours: 0, payRate: 15, billRate: 22, status: 'DRAFT' } });
    expect((await (await PAGE(req('GET'), T)).json()).referrals.mine[0].status).toBe('Working — 30 of 40 hours'); // drafts don't count
    await db.timesheet.updateMany({ where: { applicationId: app!.id }, data: { status: 'APPROVED' } });
    expect((await (await PAGE(req('GET'), T)).json()).referrals.mine[0].status).toBe('Bonus on its way');
    expect((await DECIDE(req('PATCH', { action: 'paid' }), { params: { id: refId } })).status).toBe(200);
    expect((await (await DECIDE(req('PATCH', { action: 'paid' }), { params: { id: refId } })).json()).error).toBe('Already marked paid.');
    expect(await db.auditLog.count({ where: { organizationId: org, action: 'referral.paid' } })).toBe(1);
    expect((await (await PAGE(req('GET'), T)).json()).referrals.mine[0].status).toBe('Bonus paid');
  });

  it('staff can record a referral for a worker', async () => {
    as(rec);
    expect((await STAFF_REFER(req('POST', { referrerId: worker, name: 'Gus Guest', email: 'gus@g.test' }))).status).toBe(201);
    expect(await db.referral.count({ where: { organizationId: org, referrerId: worker } })).toBe(2);
  });
});
