import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const out = vi.hoisted(() => ({ texts: [] as { to: string; body: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ id: 'e' })) }));
vi.mock('@/lib/sms', () => ({ sendSms: vi.fn(async (to: string, body: string) => { out.texts.push({ to, body }); return { id: 's' }; }) }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { CourseBody, FORKLIFT_TEMPLATE, grade, recertDate } from '@/lib/training';
import { certGaps, recertDue } from '@/lib/training-server';
import { POST as ADD_COURSE } from '@/app/api/training/courses/route';
import { POST as ASSIGN } from '@/app/api/training/enrollments/route';
import { PATCH as ENROLLMENT } from '@/app/api/training/enrollments/[id]/route';
import { GET as CERTIFICATE } from '@/app/api/training/enrollments/[id]/certificate/route';
import { POST as REFRESHER } from '@/app/api/training/refresher/route';
import { PATCH as JOB_CERTS } from '@/app/api/training/jobs/[id]/route';
import { PATCH as MOVE } from '@/app/api/applications/[id]/route';
import { GET as PAGE } from '@/app/api/public/shifts/[token]/route';
import { POST as LEARN } from '@/app/api/public/training/[token]/route';

describe('training rules', () => {
  it('grades quizzes on the server', () => {
    const qs = [{ q: 'a', choices: ['x', 'y'], answer: 1 }, { q: 'b', choices: ['x', 'y'], answer: 0 }, { q: 'c', choices: ['x', 'y'], answer: 0 }, { q: 'd', choices: ['x', 'y'], answer: 1 }];
    expect(grade(qs, [1, 0, 0, 1], 80)).toEqual({ score: 100, passed: true, wrong: [] });
    expect(grade(qs, [1, 0, 1, 0], 80)).toEqual({ score: 50, passed: false, wrong: [2, 3] });
    expect(grade(qs, [1, 0, 0, null], 75)).toEqual({ score: 75, passed: true, wrong: [3] });
  });
  it('dates recertification from the evaluation, clamping month ends', () => {
    expect(recertDate('2026-10-14', 36)).toBe('2029-10-14');
    expect(recertDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(recertDate('2028-02-29', 12)).toBe('2029-02-28');
  });
  it('ships a valid forklift course and refuses recertification longer than three years', () => {
    expect(CourseBody.safeParse(FORKLIFT_TEMPLATE).success).toBe(true);
    expect(FORKLIFT_TEMPLATE.questions.every((q) => q.answer < q.choices.length)).toBe(true);
    expect(CourseBody.safeParse({ ...FORKLIFT_TEMPLATE, recertMonths: 48 }).success).toBe(false);
    expect(CourseBody.safeParse({ ...FORKLIFT_TEMPLATE, certType: 'RN license' }).success).toBe(false);
  });
});

const RUN = `tr${Date.now()}`;
let org: string, other: string, owner: string, rec: string, otherAdmin: string, ana: string, ben: string, job: string, benApp: string, course: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const json = (method: string, body?: unknown) => new Request('http://x', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const P = (id: string) => ({ params: { id } });
const T = (token: string) => ({ params: { token } });
const tokenFor = (phone: string) => out.texts.filter((t) => t.to === phone).at(-1)!.body.match(/\/shifts\/([\w-]+)/)![1];
const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Lift Co', slug: `l-${RUN}`, plan: 'enterprise', subscriptionStatus: 'active', timezone: 'UTC' } })).id;
  other = (await db.organization.create({ data: { name: 'Other Co', slug: `o-${RUN}`, plan: 'enterprise', subscriptionStatus: 'active' } })).id;
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [owner, rec, otherAdmin] = await Promise.all([u('owner'), u('rec'), u('otheradmin')]);
  await db.membership.createMany({ data: [{ userId: owner, organizationId: org, role: 'OWNER' }, { userId: rec, organizationId: org, role: 'RECRUITER' }, { userId: otherAdmin, organizationId: other, role: 'ADMIN' }] });
  ana = (await db.candidate.create({ data: { organizationId: org, name: 'Ana Lift', phone: '+15550100001' } })).id;
  ben = (await db.candidate.create({ data: { organizationId: org, name: 'Ben Walk', phone: '+15550100002' } })).id;
  job = (await db.job.create({ data: { organizationId: org, title: 'Forklift driver', type: 'TEMP' } })).id;
  benApp = (await db.application.create({ data: { organizationId: org, candidateId: ben, jobId: job, stage: 'INTERVIEW', maxStage: 'INTERVIEW' } })).id;
});
afterAll(async () => { await db.organization.deleteMany({ where: { id: { in: [org, other] } } }); });

describe('operator training', () => {
  it('is Enterprise only, and courses are admin-only', async () => {
    as(rec);
    expect((await ADD_COURSE(json('POST', { template: 'forklift' }))).status).toBe(403);
    await db.organization.update({ where: { id: org }, data: { plan: 'growth' } });
    as(owner);
    try { expect((await ADD_COURSE(json('POST', { template: 'forklift' }))).status).toBe(402); }
    finally { await db.organization.update({ where: { id: org }, data: { plan: 'enterprise' } }); }
    const r = await ADD_COURSE(json('POST', { template: 'forklift' }));
    expect(r.status).toBe(201);
    course = (await r.json()).id;
  });

  it('takes a worker from lessons and quiz to a certified, verified credential', async () => {
    as(rec);
    const a = await (await ASSIGN(json('POST', { courseId: course, candidateIds: [ana], channels: ['sms'], dueDate: null }))).json();
    expect(a).toMatchObject({ assigned: 1, skipped: 0, problems: [] });
    expect((await (await ASSIGN(json('POST', { courseId: course, candidateIds: [ana], channels: [] }))).json()).skipped).toBe(1);
    const token = tokenFor('+15550100001');

    // The worker's page shows the course but never the answers.
    const page = await (await PAGE(new Request('http://x'), T(token))).json();
    expect(page.training).toHaveLength(1);
    const c = page.training[0];
    expect(JSON.stringify(c.questions)).not.toContain('answer');
    const id = c.id as string;
    const learn = (body: object) => LEARN(json('POST', { enrollmentId: id, ...body }), T(token));

    expect((await learn({ answers: c.questions.map(() => 0) })).status).toBe(409); // lessons first
    for (let i = 0; i < c.lessons.length; i++) expect((await learn({ lesson: i })).status).toBe(200);
    const fail = await (await learn({ answers: c.questions.map(() => 3) })).json();
    expect(fail.passed).toBe(false);
    const pass = await (await learn({ answers: FORKLIFT_TEMPLATE.questions.map((q) => q.answer) })).json();
    expect(pass).toMatchObject({ passed: true, score: 100 });
    expect((await learn({ lesson: 0 })).status).toBe(409); // closed once passed

    // Another company can't touch the record.
    as(otherAdmin, other);
    expect((await ENROLLMENT(json('PATCH', { action: 'cancel' }), P(id))).status).toBe(409);

    as(rec);
    const checklist = FORKLIFT_TEMPLATE.checklist.map((item) => ({ item, pass: true }));
    const evalBody = { action: 'evaluate', trainedAt: today(), evaluatedAt: today(), evaluatorName: 'Pat Trainer', evaluatorTitle: 'Site safety lead', equipment: 'Toyota 8FGCU25' };
    expect((await ENROLLMENT(json('PATCH', { ...evalBody, passed: true, checklist: checklist.map((x, i) => (i ? x : { ...x, pass: false })) }), P(id))).status).toBe(400);
    const done = await (await ENROLLMENT(json('PATCH', { ...evalBody, passed: true, checklist }), P(id))).json();
    expect(done).toMatchObject({ certified: true, expiresAt: recertDate(today(), 36) });
    const cred = await db.credential.findFirstOrThrow({ where: { candidateId: ana, type: 'Forklift – sit-down counterbalance' } });
    expect(cred.verifiedAt).not.toBeNull();
    expect(cred.expiresAt?.toISOString().slice(0, 10)).toBe(recertDate(today(), 36));

    const pdf = await CERTIFICATE(new Request('http://x'), P(id));
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect((await pdf.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    expect(await certGaps(tenantDb(org), ana, ['Forklift – sit-down counterbalance'], today(), today())).toEqual([]);
  });

  it('stops placing an uncertified worker unless an owner or admin overrides, and logs it', async () => {
    as(rec);
    expect((await JOB_CERTS(json('PATCH', { requiredCerts: ['Forklift – sit-down counterbalance'] }), P(job))).status).toBe(403);
    as(owner);
    expect((await JOB_CERTS(json('PATCH', { requiredCerts: ['Forklift – sit-down counterbalance'] }), P(job))).status).toBe(200);

    as(rec);
    const r = await MOVE(json('PATCH', { stage: 'PLACED' }), P(benApp));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ certOverride: true, canOverride: false });
    expect((await MOVE(json('PATCH', { stage: 'PLACED', override: 'client said fine' }), P(benApp))).status).toBe(403);
    expect((await db.application.findUniqueOrThrow({ where: { id: benApp } })).stage).toBe('INTERVIEW');

    as(owner);
    expect((await (await MOVE(json('PATCH', { stage: 'OFFER' }), P(benApp))).json()).canOverride).toBe(true);
    expect((await MOVE(json('PATCH', { stage: 'OFFER', override: 'Will only run a pallet jack until evaluated Friday' }), P(benApp))).status).toBe(200);
    const log = await db.auditLog.findFirst({ where: { organizationId: org, action: 'training.override' } });
    expect(log?.summary).toContain('Ben Walk');
    expect(log?.summary).toContain('pallet jack');
  });

  it('puts a certification on hold for refresher training, and lists recertifications due', async () => {
    as(rec);
    expect((await REFRESHER(json('POST', { candidateId: ana, courseId: course, trigger: 'Involved in an accident or near-miss', note: 'Dock 3', channels: [] }))).status).toBe(201);
    const gaps = await certGaps(tenantDb(org), ana, ['Forklift – sit-down counterbalance'], today(), today());
    expect(gaps[0]).toMatch(/on hold.*near-miss/);

    // An expiring certification with nothing under way shows as due.
    await db.credential.create({ data: { organizationId: org, candidateId: ben, type: 'Forklift – sit-down counterbalance', expiresAt: new Date(Date.now() + 20 * 864e5), verifiedAt: new Date() } });
    const due = await recertDue(tenantDb(org), today());
    expect(due.map((d) => d.name)).toEqual(['Ben Walk']); // Ana's refresher is already under way
  });
});
