import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Features the home page promises: task reminders and follow-ups, announcements, shift change requests, the API,
// and credential reminders that reach the worker.
const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const out = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; text: string }[], texts: [] as { to: string; body: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: { to: string; subject: string; text: string }) => { out.emails.push(o); return { id: 'e' }; }) }));
vi.mock('@/lib/sms', async (orig) => ({ ...(await orig<typeof import('@/lib/sms')>()), sendSms: vi.fn(async (to: string, body: string) => { out.texts.push({ to, body }); return { id: 's' }; }) }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { dueForReminder, runTaskReminders } from '@/lib/task-reminders';
import { POST as ANNOUNCE } from '@/app/api/announcements/route';
import { DELETE as TAKE_DOWN } from '@/app/api/announcements/[id]/route';
import { GET as WORKER_PAGE, POST as WORKER_POST } from '@/app/api/public/shifts/[token]/route';
import { POST as DECIDE } from '@/app/api/schedule/change-requests/[id]/route';
import { POST as NEW_KEY } from '@/app/api/settings/api-keys/route';
import { DELETE as REVOKE } from '@/app/api/settings/api-keys/[id]/route';
import { GET as JOBS, POST as NEW_JOB } from '@/app/api/v1/jobs/route';
import { GET as JOB } from '@/app/api/v1/jobs/[id]/route';
import { GET as CANDIDATES, POST as NEW_CANDIDATE } from '@/app/api/v1/candidates/route';
import { workerLink } from '@/lib/schedule-server';
import { runCredentialAlerts } from '@/lib/credentials-server';

const RUN = `hp${Date.now()}`;
let ent: string, other: string, owner: string, rec: string, viewer: string, ownerOther: string;
let branchA: string, branchB: string, worker: string, workerB: string, app: string, shift: string, token: string, otherJob: string;
const as = (u: string, o = ent) => { session.current = { user: { id: u, orgId: o } }; };
const json = (body: unknown, method = 'POST') => new Request('http://x', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const p = (id: string) => ({ params: { id } });
const day = (n: number) => new Date(Date.now() + n * 864e5);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

beforeAll(async () => {
  ent = (await db.organization.create({ data: { name: 'Big Staffing', slug: `ent-${RUN}`, plan: 'enterprise', subscriptionStatus: 'active', applyEmail: `jobs@${RUN}.test` } })).id;
  other = (await db.organization.create({ data: { name: 'Small Staffing', slug: `oth-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: `${n} Smith`, passwordHash: 'x' } }).then((x) => x.id);
  owner = await u('owner'); rec = await u('rec'); viewer = await u('viewer'); ownerOther = await u('owner2');
  await db.membership.createMany({ data: [{ userId: owner, organizationId: ent, role: 'OWNER' }, { userId: rec, organizationId: ent, role: 'RECRUITER' }, { userId: viewer, organizationId: ent, role: 'VIEWER' }, { userId: ownerOther, organizationId: other, role: 'OWNER' }] });
  const t = tenantDb(ent);
  branchA = (await t.branch.create({ data: { name: 'Tampa' } as never })).id;
  branchB = (await t.branch.create({ data: { name: 'Orlando' } as never })).id;
  const job = await t.job.create({ data: { title: 'Forklift Operator', type: 'CONTRACT', payRate: 20, billRate: 30 } as never });
  worker = (await t.candidate.create({ data: { name: 'Maria Lopez', email: `maria@${RUN}.test`, phone: '+18135550101', branchId: branchA } as never })).id;
  workerB = (await t.candidate.create({ data: { name: 'Ken Ito', email: `ken@${RUN}.test`, branchId: branchB, emailOptOut: true } as never })).id;
  app = (await t.application.create({ data: { jobId: job.id, candidateId: worker, stage: 'PLACED' } as never })).id;
  await t.application.create({ data: { jobId: job.id, candidateId: workerB, stage: 'PLACED' } as never });
  shift = (await t.shift.create({ data: { applicationId: app, date: new Date(`${ymd(day(3))}T00:00:00Z`), start: '07:00', end: '15:00', notified: true, notifiedAt: new Date() } as never })).id;
  token = (await workerLink(ent, worker, ymd(day(3)))).split('/shifts/')[1];
  otherJob = (await tenantDb(other).job.create({ data: { title: 'Secret Job' } as never })).id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('task reminders and follow-ups', () => {
  const t = (id: string, dueInDays: number, extra: Partial<{ remindedAt: Date; followedUpAt: Date; priority: string }> = {}) =>
    ({ id, title: id, dueAt: day(dueInDays), priority: extra.priority ?? 'Normal', remindedAt: extra.remindedAt ?? null, followedUpAt: extra.followedUpAt ?? null });
  it('reminds once before the due date, again if the date moves, and follows up on overdue tasks every few days', () => {
    const now = new Date();
    const r = dueForReminder([t('soon', 1), t('far', 9), t('reminded', 1, { remindedAt: now }), t('moved', 1.5, { remindedAt: day(-9) }),
      t('late', -1, { priority: 'High' }), t('nagged', -5, { followedUpAt: day(-1) }), t('nagAgain', -5, { followedUpAt: day(-3) }), t('ancient', -90)], now);
    expect(r.soon.map((x) => x.id)).toEqual(['soon', 'moved']);
    expect(r.overdue.map((x) => x.id)).toEqual(['late', 'nagAgain']);
  });
  it('emails each owner one digest, unassigned tasks to the admins, and marks what was sent', async () => {
    const tdb = tenantDb(ent);
    await tdb.task.createMany({ data: [
      { title: 'Call Maria back', dueAt: day(1), assigneeId: rec },
      { title: 'Reference check for Ken', dueAt: day(-2), assigneeId: rec, priority: 'High' },
      { title: 'Renew the COI', dueAt: day(-1) },
      { title: 'Already done', dueAt: day(-1), assigneeId: rec, done: true },
    ] as never });
    out.emails = [];
    await runTaskReminders(new Date());
    const toRec = out.emails.filter((e) => e.to === `rec@${RUN}.test`);
    expect(toRec).toHaveLength(1);
    expect(toRec[0].subject).toBe('1 overdue task, 1 due soon');
    expect(toRec[0].text).toContain('[High] Reference check for Ken');
    expect(toRec[0].text).not.toContain('Already done');
    expect(out.emails.find((e) => e.to === `owner@${RUN}.test`)?.subject).toContain('(no one assigned)');
    expect(out.emails.some((e) => e.to === `viewer@${RUN}.test`)).toBe(false);
    out.emails = [];
    await runTaskReminders(new Date());
    expect(out.emails.filter((e) => e.to.endsWith(`@${RUN}.test`))).toHaveLength(0); // nothing twice in a day
    expect(await tdb.message.count({ where: { relatedType: 'task_reminder' } })).toBeGreaterThanOrEqual(2);
  });
});

describe('announcements', () => {
  it('reach everyone or one location, show on their own page, and email only those who haven’t opted out', async () => {
    as(viewer);
    expect((await ANNOUNCE(json({ title: 'Hi', body: 'Hello' }))).status).toBe(403);
    as(rec);
    out.emails = [];
    const all = await (await ANNOUNCE(json({ title: 'Holiday hours', body: 'Closed Thursday, {{first_name}}.', email: true }))).json();
    expect(all.reach).toBe(2);
    expect(all.emailed).toMatchObject({ sent: 1, skipped: 1 });
    expect(out.emails.map((e) => [e.to, e.text])).toEqual([[`maria@${RUN}.test`, 'Closed Thursday, Maria.']]);
    const orlando = await (await ANNOUNCE(json({ title: 'Orlando parking', body: 'Use lot B.', branchId: branchB }))).json();
    expect(orlando.reach).toBe(1);
    expect((await ANNOUNCE(json({ title: 'x', body: 'Hello', branchId: 'nope' }))).status).toBe(400);
    const page = await (await WORKER_PAGE(new Request('http://x'), { params: { token } })).json();
    expect(page.announcements.map((a: { title: string }) => a.title)).toEqual(['Holiday hours']); // not Orlando's
    as(viewer);
    expect((await TAKE_DOWN(new Request('http://x', { method: 'DELETE' }), p(orlando.id))).status).toBe(403);
    as(ownerOther, other);
    expect((await TAKE_DOWN(new Request('http://x', { method: 'DELETE' }), p(all.id))).status).toBe(404);
    as(owner);
    expect((await TAKE_DOWN(new Request('http://x', { method: 'DELETE' }), p(all.id))).status).toBe(200);
  });
});

describe('shift change requests', () => {
  const ask = (body: object) => WORKER_POST(json(body), { params: { token } });
  it('a worker asks, the team gets a task, a manager answers once, and the worker hears back', async () => {
    expect((await ask({ changeShiftId: shift, kind: 'CHANGE', note: '' })).status).toBe(400); // a change needs a note
    expect((await ask({ changeShiftId: shift, kind: 'DROP', note: 'Doctor’s appointment' })).status).toBe(200);
    expect((await ask({ changeShiftId: shift, kind: 'DROP' })).status).toBe(409); // one open request per shift
    const tdb = tenantDb(ent);
    const req = await tdb.shiftChangeRequest.findFirstOrThrow({ where: { shiftId: shift } });
    expect(await tdb.task.count({ where: { related: `shiftchange:${req.id}`, done: false } })).toBe(1);
    const page = await (await WORKER_PAGE(new Request('http://x'), { params: { token } })).json();
    expect(page.shifts[0].change).toMatchObject({ kind: 'DROP', status: 'PENDING' });

    as(ownerOther, other);
    expect((await DECIDE(json({ approve: true }), p(req.id))).status).toBe(404);
    as(viewer);
    expect((await DECIDE(json({ approve: true }), p(req.id))).status).toBe(403);
    as(rec);
    out.emails = [];
    const r = await (await DECIDE(json({ approve: true, reply: 'Feel better!' }), p(req.id))).json();
    expect(r).toMatchObject({ told: true, cancelled: true });
    expect(out.emails[0]).toMatchObject({ to: `maria@${RUN}.test`, subject: 'Your shift request: approved' });
    expect(out.emails[0].text).toContain('Feel better!');
    expect((await tdb.shift.findFirstOrThrow({ where: { id: shift } })).cancelled).toBe(true);
    expect(await tdb.task.count({ where: { related: `shiftchange:${req.id}`, done: false } })).toBe(0);
    expect((await DECIDE(json({ approve: false }), p(req.id))).status).toBe(409);
  });
});

describe('the API (Enterprise)', () => {
  let key = '';
  const call = (h: typeof JOBS, url: string, k = key, init: RequestInit = {}) => h(new Request(url, { ...init, headers: { ...(k ? { Authorization: `Bearer ${k}` } : {}), 'Content-Type': 'application/json' } }), {});
  it('only admins on Enterprise make keys, and the key is shown once', async () => {
    as(rec);
    expect((await NEW_KEY(json({ name: 'Warehouse' }))).status).toBe(403);
    as(ownerOther, other);
    expect((await NEW_KEY(json({ name: 'Warehouse' }))).status).toBe(402); // Growth plan: upgrade needed
    as(owner);
    const k = await (await NEW_KEY(json({ name: 'Warehouse' }))).json();
    expect(k.key).toMatch(/^pk_live_/);
    key = k.key;
    const row = await tenantDb(ent).apiKey.findFirstOrThrow({ where: { id: k.id } });
    expect(row.keyHash).not.toContain(key.slice(8)); // only a hash is kept
    expect(await tenantDb(ent).auditLog.count({ where: { action: 'settings.api_key' } })).toBe(1);
  });
  it('reads and adds records for its own company only', async () => {
    expect((await call(JOBS, 'http://x/api/v1/jobs', '')).status).toBe(401);
    expect((await call(JOBS, 'http://x/api/v1/jobs', 'pk_live_' + 'x'.repeat(40))).status).toBe(401);
    const jobs = await (await call(JOBS, 'http://x/api/v1/jobs')).json();
    expect(jobs.data.map((j: { title: string }) => j.title)).toEqual(['Forklift Operator']);
    expect(jobs.data[0].payRate).toBe('20');
    expect((await JOB(new Request('http://x', { headers: { Authorization: `Bearer ${key}` } }), { params: { id: otherJob } })).status).toBe(404);
    const made = await call(NEW_JOB, 'http://x/api/v1/jobs', key, { method: 'POST', body: JSON.stringify({ title: 'Picker', payRate: 18.5 }) });
    expect(made.status).toBe(201);
    expect(await made.json()).toMatchObject({ title: 'Picker', published: false, payRate: '18.5' });
    const c = await call(NEW_CANDIDATE, 'http://x/api/v1/candidates', key, { method: 'POST', body: JSON.stringify({ name: 'Ana Ruiz', email: `ana@${RUN}.test` }) });
    expect(c.status).toBe(201);
    expect((await call(NEW_CANDIDATE, 'http://x/api/v1/candidates', key, { method: 'POST', body: JSON.stringify({ name: 'Ana Again', email: `ANA@${RUN}.test` }) })).status).toBe(409);
    expect((await call(NEW_CANDIDATE, 'http://x/api/v1/candidates', key, { method: 'POST', body: JSON.stringify({ email: 'nope' }) })).status).toBe(400);
    const page1 = await (await call(CANDIDATES, 'http://x/api/v1/candidates?limit=2')).json();
    expect(page1.data).toHaveLength(2);
    const page2 = await (await call(CANDIDATES, `http://x/api/v1/candidates?limit=2&cursor=${page1.nextCursor}`)).json();
    expect([...page1.data, ...page2.data].map((x: { name: string }) => x.name).sort()).toEqual(['Ana Ruiz', 'Ken Ito', 'Maria Lopez']);
    expect(page2.nextCursor).toBeNull();
    expect(JSON.stringify(page1)).not.toMatch(/race|gender|veteran|disability/i);
  });
  it('stops working the moment it’s revoked', async () => {
    as(owner);
    const id = (await tenantDb(ent).apiKey.findFirstOrThrow({ where: { revokedAt: null } })).id;
    expect((await REVOKE(new Request('http://x', { method: 'DELETE' }), p(id))).status).toBe(200);
    expect((await call(JOBS, 'http://x/api/v1/jobs')).status).toBe(401);
  });
});

describe('credential reminders reach the worker', () => {
  it('each worker gets one message about their own credentials; opted-out workers are skipped and logged', async () => {
    const tdb = tenantDb(ent);
    await tdb.credential.createMany({ data: [
      { candidateId: worker, type: 'Other', name: 'RN license', expiresAt: day(20) },
      { candidateId: worker, type: 'Other', name: 'BLS', expiresAt: day(-1) },
      { candidateId: workerB, type: 'Other', name: 'Forklift card', expiresAt: day(5) },
    ] as never });
    out.emails = []; out.texts = [];
    await runCredentialAlerts(new Date());
    const toMaria = out.emails.filter((e) => e.to === `maria@${RUN}.test`);
    expect(toMaria).toHaveLength(1);
    expect(toMaria[0].text).toMatch(/BLS: expired[\s\S]*RN license: expires|RN license: expires[\s\S]*BLS: expired/);
    expect(toMaria[0].text).toContain(`jobs@${RUN}.test`);
    expect(out.emails.some((e) => e.to === `ken@${RUN}.test`)).toBe(false); // opted out of email
    expect(await tdb.message.count({ where: { toAddress: `ken@${RUN}.test`, status: 'blocked_opt_out', body: { contains: 'Forklift card' } } })).toBe(1);
    expect(out.emails.some((e) => e.to === `owner@${RUN}.test`)).toBe(true); // the team still hears too
  });
});
