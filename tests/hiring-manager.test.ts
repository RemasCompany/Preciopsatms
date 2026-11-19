import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ id: 'e1' })) }));
vi.mock('@/lib/sms', async (orig) => ({ ...(await orig<typeof import('@/lib/sms')>()), sendSms: vi.fn(async () => ({ id: 's1' })) }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { PATCH as MOVE } from '@/app/api/applications/[id]/route';
import { POST as INTERVIEW } from '@/app/api/interviews/route';
import { PATCH as CHANGE_INTERVIEW } from '@/app/api/interviews/[id]/route';
import { GET as NOTES, POST as ADD_NOTE, DELETE as DEL_NOTE } from '@/app/api/candidates/[id]/notes/route';
import { GET as RECORD } from '@/app/api/records/[kind]/[id]/route';

const RUN = `hm${Date.now()}`;
let org: string, other: string, admin: string, rec: string, hm: string, plainViewer: string, outsider: string;
let mine: string, theirs: string, cand: string, appMine: string, appTheirs: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const body = (b: object, method = 'POST') => new Request('http://x', { method, body: JSON.stringify(b) });
const p = (id: string) => ({ params: { id } });
const move = async (app: string, stage: string, extra: object = {}) => (await MOVE(body({ stage, ...extra }, 'PATCH'), p(app))).status;
const slot = () => { const d = new Date(Date.now() + 5 * 864e5); return `${d.toISOString().slice(0, 10)}T10:00`; };
const interview = async (app: string, by: string) => { const r = await INTERVIEW(body({ applicationId: app, kind: 'VIDEO', durationMin: 30, interviewerIds: [by], slots: [slot()], channels: [] })); return { status: r.status, body: await r.json() }; };
const note = async (b: object) => { const r = await ADD_NOTE(body(b), { params: { id: cand } }); return { status: r.status, body: await r.json() }; };

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Acme', slug: `acme-${RUN}`, plan: 'growth', subscriptionStatus: 'active', kind: 'EMPLOYER', timezone: 'America/New_York' } })).id;
  other = (await db.organization.create({ data: { name: 'Other', slug: `other-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: `${n} Person`, passwordHash: 'x' } }).then((x) => x.id);
  [admin, rec, hm, plainViewer, outsider] = await Promise.all([u('admin'), u('rec'), u('hm'), u('viewer'), u('outsider')]);
  await db.membership.createMany({ data: [{ userId: admin, organizationId: org, role: 'ADMIN' }, { userId: rec, organizationId: org, role: 'RECRUITER' }, { userId: hm, organizationId: org, role: 'VIEWER' }, { userId: plainViewer, organizationId: org, role: 'VIEWER' }, { userId: outsider, organizationId: other, role: 'OWNER' }] });
  const t = tenantDb(org);
  // The hiring manager is an employee who signs in with their work email.
  const hmPerson = await t.candidate.create({ data: { name: 'Hana Manager' } as never });
  const hmEmp = await t.employee.create({ data: { candidateId: hmPerson.id, title: 'Warehouse Manager', startDate: new Date('2024-01-01'), payRate: 30, workEmail: `HM@${RUN}.test` } as never });
  mine = (await t.job.create({ data: { title: 'Picker', type: 'FULL_TIME', managerId: hmEmp.id } as never })).id;
  theirs = (await t.job.create({ data: { title: 'Accountant', type: 'FULL_TIME' } as never })).id;
  cand = (await t.candidate.create({ data: { name: 'Ana Applicant', email: `ana@${RUN}.test` } as never })).id;
  appMine = (await t.application.create({ data: { jobId: mine, candidateId: cand, stage: 'APPLIED' } as never })).id;
  appTheirs = (await t.application.create({ data: { jobId: theirs, candidateId: cand, stage: 'APPLIED' } as never })).id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
});

describe('a hiring manager reviewing applicants', () => {
  it('moves their own job’s applicants between stages, but can’t hire and can’t touch other jobs', async () => {
    as(hm);
    expect(await move(appMine, 'SCREENED')).toBe(200);
    expect(await move(appMine, 'REJECTED')).toBe(400); // a rejection still needs a reason
    expect(await move(appMine, 'PLACED')).toBe(403);
    expect(await move(appTheirs, 'SCREENED')).toBe(403);
    as(plainViewer);
    expect(await move(appMine, 'INTERVIEW')).toBe(403); // an ordinary viewer is still read-only
    as(rec);
    expect(await move(appTheirs, 'SCREENED')).toBe(200);
  });

  it('sets up interviews for their own job and can reschedule or cancel them', async () => {
    as(hm);
    const ok = await interview(appMine, hm);
    expect(ok.status).toBe(201);
    expect((await tenantDb(org).application.findFirstOrThrow({ where: { id: appMine } })).stage).toBe('INTERVIEW');
    expect((await interview(appTheirs, hm)).status).toBe(403);
    expect((await CHANGE_INTERVIEW(body({ action: 'cancel', reason: 'Position paused', notify: false }, 'PATCH'), p(ok.body.id))).status).toBe(200);
    as(rec);
    const theirsIv = await interview(appTheirs, rec);
    as(hm);
    expect((await CHANGE_INTERVIEW(body({ action: 'cancel' }, 'PATCH'), p(theirsIv.body.id))).status).toBe(403);
  });

  it('adds notes about their own job’s application; recruiters can add general notes; only the author or an admin deletes', async () => {
    as(hm);
    expect((await note({ body: 'Great forklift experience; available nights.', applicationId: appMine })).status).toBe(201);
    expect((await note({ body: 'General thought' })).status).toBe(403);
    expect((await note({ body: 'About the other job', applicationId: appTheirs })).status).toBe(403);
    expect((await note({ body: '   ', applicationId: appMine })).status).toBe(400);
    as(rec);
    const recNote = await note({ body: 'Phone screen went well.' });
    expect(recNote.status).toBe(201);
    as(hm);
    const list = (await (await NOTES(new Request('http://x'), { params: { id: cand } })).json()).notes;
    expect(list.map((n: { author: string; job: string | null }) => [n.author, n.job])).toEqual([['rec Person', null], ['hm Person', 'Picker']]);
    expect(list.find((n: { author: string }) => n.author === 'rec Person').canDelete).toBe(false);
    expect((await DEL_NOTE(new Request(`http://x?note=${recNote.body.id}`, { method: 'DELETE' }), { params: { id: cand } })).status).toBe(403);
    const own = list.find((n: { author: string }) => n.author === 'hm Person');
    expect((await DEL_NOTE(new Request(`http://x?note=${own.id}`, { method: 'DELETE' }), { params: { id: cand } })).status).toBe(200);
    as(admin);
    expect((await DEL_NOTE(new Request(`http://x?note=${recNote.body.id}`, { method: 'DELETE' }), { params: { id: cand } })).status).toBe(200);
    as(outsider, other);
    expect((await note({ body: 'x' })).status).toBe(404);
  });

  it('the candidate record tells the screen which applications they can work', async () => {
    as(hm);
    const r = await (await RECORD(new Request('http://x'), { params: { kind: 'candidates', id: cand } })).json();
    const by = Object.fromEntries(r.extras.applications.map((a: { id: string; canAct: boolean }) => [a.id, a.canAct]));
    expect(by).toEqual({ [appMine]: true, [appTheirs]: false });
    as(rec);
    const r2 = await (await RECORD(new Request('http://x'), { params: { kind: 'candidates', id: cand } })).json();
    expect(r2.extras.applications.every((a: { canAct: boolean }) => a.canAct)).toBe(true);
  });
});
