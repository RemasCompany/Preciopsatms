import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const out = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; text: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: { to: string; subject: string; text: string }) => { out.emails.push(o); return { id: 'e1' }; }) }));
vi.mock('@/lib/sms', async (orig) => ({ ...(await orig<typeof import('@/lib/sms')>()), sendSms: vi.fn(async () => ({ id: 's1' })) }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { GET as ONE } from '@/app/api/employees/[id]/route';
import { POST as PROPOSE } from '@/app/api/employees/[id]/job-changes/route';
import { POST as DECIDE } from '@/app/api/job-changes/[id]/route';
import { PATCH as SETTINGS } from '@/app/api/job-changes/settings/route';
import { runPeopleDaily } from '@/lib/people';

const RUN = `jc${Date.now()}`;
let org: string, other: string, owner: string, managerUser: string, peerUser: string, viewer: string, outsider: string;
let boss: string, lead: string, worker: string, peer: string, ops: string, branch: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const json = (body: object) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
const p = (id: string) => ({ params: { id } });
const propose = async (empId: string, body: object) => { const r = await PROPOSE(json({ effectiveDate: today(), reason: 'Strong review and led the night team', ...body }), p(empId)); return { status: r.status, body: await r.json() }; };
const decide = async (id: string, body: object) => { const r = await DECIDE(json(body), p(id)); return { status: r.status, body: await r.json() }; };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const plus = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const emp = (id: string) => db.employee.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Acme', slug: `acme-${RUN}`, plan: 'growth', subscriptionStatus: 'active', kind: 'EMPLOYER', timezone: 'America/Chicago' } })).id;
  other = (await db.organization.create({ data: { name: 'Other', slug: `other-${RUN}`, plan: 'growth', subscriptionStatus: 'active', kind: 'EMPLOYER' } })).id;
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [owner, managerUser, peerUser, viewer, outsider] = await Promise.all([u('owner'), u('manager'), u('peer'), u('viewer'), u('outsider')]);
  await db.membership.createMany({ data: [{ userId: owner, organizationId: org, role: 'OWNER' }, { userId: managerUser, organizationId: org, role: 'RECRUITER' }, { userId: peerUser, organizationId: org, role: 'RECRUITER' }, { userId: viewer, organizationId: org, role: 'VIEWER' }, { userId: outsider, organizationId: other, role: 'OWNER' }] });
  const t = tenantDb(org);
  ops = (await t.department.create({ data: { name: 'Operations' } as never })).id;
  branch = (await t.branch.create({ data: { name: 'Tampa' } as never })).id;
  const person = async (name: string, data: object) => {
    const c = await t.candidate.create({ data: { name, email: `${name.toLowerCase().replace(/\s/g, '.')}@${RUN}.test` } as never });
    return (await t.employee.create({ data: { candidateId: c.id, title: 'Clerk', startDate: new Date('2025-01-06'), payType: 'HOURLY', payRate: 20, ...data } as never })).id;
  };
  boss = await person('Big Boss', { title: 'Director', workEmail: `manager@${RUN}.test` }); // the manager signs in with this email
  lead = await person('Line Lead', { managerId: boss, title: 'Lead' });
  worker = await person('Wanda Worker', { managerId: lead });
  peer = await person('Pat Peer', { workEmail: `peer@${RUN}.test` });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
});

describe('who can start a job change', () => {
  it('managers up the reporting line and HR; not peers, viewers, other companies, or yourself', async () => {
    as(peerUser);
    expect((await propose(worker, { kind: 'PROMOTION', toTitle: 'Senior Clerk' })).status).toBe(403);
    expect((await (await ONE(new Request('http://x'), p(worker))).json())).toMatchObject({ canChangeJob: false, jobChanges: null });
    as(viewer);
    expect((await propose(worker, { kind: 'PROMOTION', toTitle: 'Senior Clerk' })).status).toBe(403);
    as(outsider, other);
    expect((await propose(worker, { kind: 'PROMOTION', toTitle: 'Senior Clerk' })).status).toBe(404);
    as(managerUser);
    const self = await propose(boss, { kind: 'PROMOTION', toTitle: 'VP' });
    expect(self.status).toBe(403);
    expect(self.body.error).toContain('your own job');
    expect((await (await ONE(new Request('http://x'), p(worker))).json()).canChangeJob).toBe(true); // two levels down still counts
  });
});

describe('a manager’s promotion goes to HR', () => {
  let id = '';
  it('is checked, then waits for approval and HR is emailed', async () => {
    as(managerUser);
    expect((await propose(worker, { kind: 'PROMOTION' })).body.error).toContain('Nothing changes');
    expect((await propose(worker, { kind: 'PROMOTION', toPayRate: 18 })).body.error).toContain('lower');
    expect((await propose(worker, { kind: 'PROMOTION', toTitle: 'Senior Clerk', reason: 'x' })).status).toBe(400); // reason required
    out.emails = [];
    // Exactly what the form sends: blanks for anything left as “no change”.
    const r = await propose(worker, { kind: 'PROMOTION', toTitle: 'Senior Clerk', toPayRate: 23, toPayType: 'HOURLY', toDepartmentId: ops, toManagerId: '', toBranchId: '', notifyEmployee: true });
    expect(r).toMatchObject({ status: 201, body: { pending: true } });
    expect(out.emails.map((e) => e.to)).toEqual([`owner@${RUN}.test`]);
    expect(out.emails[0].subject).toBe('Approval needed: promotion for Wanda Worker');
    expect((await emp(worker)).title).toBe('Clerk'); // nothing changes yet
    expect((await propose(worker, { kind: 'PAY', toPayRate: 21 })).status).toBe(409); // one pending at a time
    const view = await (await ONE(new Request('http://x'), p(worker))).json();
    id = view.jobChanges[0].id;
    expect(view.jobChanges[0]).toMatchObject({ status: 'PENDING', toTitle: 'Senior Clerk', payChange: true, fromPay: null, toPay: null, canCancel: true }); // managers never see pay
    expect((await decide(id, { action: 'approve' })).status).toBe(403); // managers can't approve
  });
  it('HR approves with the final pay: it applies, the employee gets a written notice, and the manager hears back', async () => {
    as(owner);
    out.emails = [];
    const r = await decide(id, { action: 'approve', toPayRate: 24, note: 'Budget allows 24' });
    expect(r.status).toBe(200);
    expect(r.body.message).toContain('written notice');
    const e = await emp(worker);
    expect(e).toMatchObject({ title: 'Senior Clerk', departmentId: ops });
    expect(Number(e.payRate)).toBe(24);
    const notice = out.emails.find((m) => m.to === `wanda.worker@${RUN}.test`)!;
    expect(notice.subject).toBe('Your promotion at Acme');
    expect(notice.text).toContain('Position: Senior Clerk (was Clerk)');
    expect(notice.text).toContain('$24.00/hr (was $20.00/hr)');
    expect(out.emails.find((m) => m.to === `manager@${RUN}.test`)!.subject).toBe('Approved: promotion for Wanda Worker');
    const hist = await tenantDb(org).compensationChange.findMany({ where: { employeeId: worker } });
    expect(hist.map((h) => h.reason)).toContainEqual(expect.stringMatching(/^Promotion: Strong review/));
    expect(await tenantDb(org).auditLog.count({ where: { action: 'employee.job_change' } })).toBeGreaterThanOrEqual(2);
    expect((await decide(id, { action: 'decline' })).status).toBe(409);
  });
});

describe('HR changes and safeguards', () => {
  it('HR’s own changes apply at once; a future move waits for its date; a pay cut can’t be backdated', async () => {
    as(owner);
    expect((await propose(lead, { kind: 'DEMOTION', toTitle: 'Clerk', toPayRate: 18, effectiveDate: plus(-3) })).body.error).toContain('can’t be backdated');
    const move = await propose(lead, { kind: 'LATERAL', toBranchId: branch, toManagerId: peer, effectiveDate: plus(10), notifyEmployee: false });
    expect(move.body).toMatchObject({ pending: false, applied: false });
    expect((await emp(lead)).branchId).toBeNull();
    await runPeopleDaily(new Date(Date.now() + 11 * 864e5));
    expect(await emp(lead)).toMatchObject({ branchId: branch, managerId: peer });
    // worker → lead → peer now, so peer can't report to worker (a loop), and nobody can manage themselves.
    expect((await propose(peer, { kind: 'LATERAL', toManagerId: worker })).body.error).toMatch(/loop/);
    expect((await propose(worker, { kind: 'LATERAL', toManagerId: worker })).body.error).toMatch(/own manager/);
  });
  it('an approved change can be cancelled before its date, taking its pay line with it', async () => {
    as(owner);
    const r = await propose(worker, { kind: 'PAY', toPayRate: 26, effectiveDate: plus(20), notifyEmployee: false });
    expect(r.status).toBe(201);
    const c = await tenantDb(org).jobChange.findFirstOrThrow({ where: { employeeId: worker, kind: 'PAY' } });
    expect(await tenantDb(org).compensationChange.count({ where: { employeeId: worker, payRate: 26 } })).toBe(1);
    expect((await decide(c.id, { action: 'cancel' })).status).toBe(200);
    expect(await tenantDb(org).compensationChange.count({ where: { employeeId: worker, payRate: 26 } })).toBe(0);
  });
  it('with approval turned off, a manager’s change applies without HR', async () => {
    as(managerUser);
    expect((await SETTINGS(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ approval: false }) }))).status).toBe(403);
    as(owner);
    expect((await SETTINGS(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ approval: false }) }))).status).toBe(200);
    as(managerUser);
    // The lead moved under someone else, so the boss no longer manages the worker…
    expect((await propose(worker, { kind: 'LATERAL', toTitle: 'Inventory Clerk' })).status).toBe(403);
    await db.employee.update({ where: { id: lead }, data: { managerId: boss } }); // …until the lead reports to the boss again
    const r = await propose(worker, { kind: 'LATERAL', toTitle: 'Inventory Clerk', notifyEmployee: false });
    expect(r.body).toMatchObject({ pending: false });
    expect((await emp(worker)).title).toBe('Inventory Clerk');
  });
});
