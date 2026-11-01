import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ id: 'e' })) }));
vi.mock('@/lib/sms', () => ({ sendSms: vi.fn(async () => ({ id: 's' })) }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { candidatesFor, workState, NLC_STATES } from '@/lib/requirements';
import { jobReadiness } from '@/lib/requirements-server';
import { PATCH as JOB_REQS } from '@/app/api/credentials/jobs/[id]/route';
import { PATCH as TRAINING_REQS } from '@/app/api/training/jobs/[id]/route';
import { POST as ADD_SHIFT } from '@/app/api/shifts/route';
import { PATCH as MOVE } from '@/app/api/applications/[id]/route';

describe('where a license is valid', () => {
  it('reads the state from a job location', () => {
    expect(workState('Tampa, FL')).toBe('FL');
    expect(workState('Austin, tx 78701')).toBe('TX');
    expect(workState('Remote')).toBeNull();
    expect(workState(null)).toBeNull();
  });
  it('takes a same-state license, or a compact license in compact states only, and never for APRNs', () => {
    const held = [{ type: 'RN license', state: 'GA' }, { type: 'Compact (multistate) nursing license', state: 'TX' }];
    expect(candidatesFor('RN license', held, 'GA')).toEqual(held); // Georgia license, or the TX multistate one
    expect(candidatesFor('RN license', held, 'FL')).toEqual([held[1]]); // TX multistate works in Florida
    expect(NLC_STATES.has('MA')).toBe(false);
    expect(candidatesFor('RN license', held, 'MA')).toEqual([]); // Massachusetts hasn't implemented the compact
    expect(candidatesFor('APRN / NP license', [{ type: 'Compact (multistate) nursing license', state: 'TX' }], 'FL')).toEqual([]);
    expect(candidatesFor('BLS', [{ type: 'BLS', state: null }], 'FL')).toHaveLength(1); // not state-issued
    expect(candidatesFor('RN license', held, null)).toEqual([held[0]]); // no state known: any license of the type
  });
});

const RUN = `rq${Date.now()}`;
let org: string, other: string, owner: string, rec: string, job: string, maJob: string;
const apps: Record<string, string> = {};
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const json = (method: string, body?: unknown) => new Request('http://x', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const P = (id: string) => ({ params: { id } });
const soon = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const shift = (applicationId: string, override?: string) => ADD_SHIFT(json('POST', { applicationId, dates: [soon(3)], start: '07:00', end: '19:00', breakMinutes: 30, ...(override ? { override } : {}) }));

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Care Staff', slug: `c-${RUN}`, plan: 'growth', subscriptionStatus: 'active', timezone: 'UTC' } })).id;
  other = (await db.organization.create({ data: { name: 'Other', slug: `o-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  owner = await u('owner'); rec = await u('rec');
  await db.membership.createMany({ data: [{ userId: owner, organizationId: org, role: 'OWNER' }, { userId: rec, organizationId: org, role: 'RECRUITER' }, { userId: owner, organizationId: other, role: 'OWNER' }] });
  const t = tenantDb(org);
  job = (await t.job.create({ data: { title: 'ICU RN', location: 'Tampa, FL', type: 'CONTRACT', payRate: 55, billRate: 80 } as never })).id;
  maJob = (await t.job.create({ data: { title: 'ICU RN', location: 'Boston, MA', type: 'CONTRACT', payRate: 60, billRate: 90 } as never })).id;
  const verified = { verifiedAt: new Date(), expiresAt: new Date(Date.now() + 400 * 864e5), number: '123' };
  const person = async (name: string, creds: { type: string; state?: string; verified?: boolean }[], jobs = [job]) => {
    const c = await t.candidate.create({ data: { name, email: `${name}@x.test` } as never });
    for (const cr of creds) await t.credential.create({ data: { candidateId: c.id, type: cr.type, state: cr.state ?? null, ...(cr.verified === false ? { expiresAt: verified.expiresAt, number: '1' } : verified) } as never });
    for (const j of jobs) apps[`${name}@${j}`] = (await t.application.create({ data: { candidateId: c.id, jobId: j, stage: 'PLACED' } as never })).id;
    return c.id;
  };
  await person('ana', [{ type: 'RN license', state: 'GA' }, { type: 'BLS' }]); // licensed in the wrong state
  await person('ben', [{ type: 'Compact (multistate) nursing license', state: 'TX' }, { type: 'BLS' }], [job, maJob]); // multistate
  await person('cara', [{ type: 'RN license', state: 'FL', verified: false }, { type: 'BLS' }]); // not verified yet
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('job requirements on the Credentials plan', () => {
  it('only an owner or admin sets them, from the credential list', async () => {
    as(rec);
    expect((await JOB_REQS(json('PATCH', { requiredCerts: ['RN license'] }), P(job))).status).toBe(403);
    as(owner);
    expect((await JOB_REQS(json('PATCH', { requiredCerts: ['Made up'] }), P(job))).status).toBe(400);
    expect((await JOB_REQS(json('PATCH', { requiredCerts: ['RN license', 'BLS'] }), P(job))).status).toBe(200);
    expect((await JOB_REQS(json('PATCH', { requiredCerts: ['RN license', 'BLS'] }), P(maJob))).status).toBe(200);
    // Another company can't touch this job.
    as(owner, other);
    expect((await JOB_REQS(json('PATCH', { requiredCerts: [] }), P(job))).status).toBe(404);
    expect((await tenantDb(org).job.findFirst({ where: { id: job } }))!.requiredCerts).toEqual(['RN license', 'BLS']);
  });

  it('stops scheduling someone licensed in another state, with an admin override that is logged', async () => {
    as(rec);
    const r = await shift(apps[`ana@${job}`]);
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.error).toMatch(/RN license: needs a FL license or a multistate \(compact\) license — only GA on file/);
    expect([j.certOverride, j.canOverride]).toEqual([true, false]);
    expect((await shift(apps[`ana@${job}`], 'Travel contract starts Monday')).status).toBe(403);
    as(owner);
    expect((await shift(apps[`ana@${job}`], 'FL license issued today, verifying tomorrow')).status).toBe(201);
    expect(await db.auditLog.count({ where: { organizationId: org, action: 'training.override', summary: { contains: 'ana' } } })).toBe(1);
  });

  it('takes a multistate license in Florida but not in Massachusetts, and stops an unverified one', async () => {
    as(rec);
    expect((await shift(apps[`ben@${job}`])).status).toBe(201);
    const ma = await (await shift(apps[`ben@${maJob}`])).json();
    expect(ma.error).toMatch(/needs a MA license — MA doesn’t accept multistate licenses/);
    expect((await (await shift(apps[`cara@${job}`])).json()).error).toMatch(/RN license: not verified/);
  });

  it('checks again on an offer or placement', async () => {
    const t = tenantDb(org);
    const c = await t.candidate.create({ data: { name: 'dee' } as never });
    const a = await t.application.create({ data: { candidateId: c.id, jobId: job, stage: 'INTERVIEW' } as never });
    as(rec);
    const r = await MOVE(json('PATCH', { stage: 'PLACED' }), P(a.id));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/RN license: needs a FL license or a multistate \(compact\) license; none on file; BLS: not certified/);
  });

  it('shows each job’s readiness', async () => {
    const jobs = await jobReadiness(tenantDb(org), { timezone: 'UTC' });
    const fl = jobs.find((j) => j.id === job)!;
    expect(fl.state).toBe('FL');
    expect(Object.fromEntries(fl.workers.map((w) => [w.name, w.gaps.length]))).toEqual({ ana: 1, ben: 0, cara: 1 });
  });

  it('the Training page’s editor only changes equipment certifications', async () => {
    const ent = (await db.organization.create({ data: { name: 'Ent', slug: `e-${RUN}`, plan: 'enterprise', subscriptionStatus: 'active' } })).id;
    await db.membership.create({ data: { userId: owner, organizationId: ent, role: 'OWNER' } });
    const j = (await tenantDb(ent).job.create({ data: { title: 'Warehouse RN', requiredCerts: ['RN license'] } as never })).id;
    as(owner, ent);
    expect((await TRAINING_REQS(json('PATCH', { requiredCerts: ['Forklift – order picker'] }), P(j))).status).toBe(200);
    expect((await tenantDb(ent).job.findFirst({ where: { id: j } }))!.requiredCerts).toEqual(['RN license', 'Forklift – order picker']);
  });
});
