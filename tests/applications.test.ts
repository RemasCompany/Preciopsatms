import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { db } from '@/lib/db';
import { POST } from '@/app/api/applications/route';
import { PATCH } from '@/app/api/applications/[id]/route';

const RUN = `a${Date.now()}`;
let org: string, other: string, job: string, otherJob: string, cand: string, cand2: string;

const post = (body: object) => POST(new Request('http://x/api/applications', { method: 'POST', body: JSON.stringify(body) }));
const patch = (id: string, body: object) => PATCH(new Request(`http://x/api/applications/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), { params: { id } });

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'A', slug: `a-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  other = (await db.organization.create({ data: { name: 'B', slug: `b-${RUN}` } })).id;
  job = (await db.job.create({ data: { organizationId: org, title: 'Picker', openings: 1 } })).id;
  otherJob = (await db.job.create({ data: { organizationId: other, title: 'Theirs' } })).id;
  cand = (await db.candidate.create({ data: { organizationId: org, name: 'Pat One' } })).id;
  cand2 = (await db.candidate.create({ data: { organizationId: org, name: 'Sam Two' } })).id;
  const user = await db.user.create({ data: { email: `r@${RUN}.test`, passwordHash: 'x' } });
  await db.membership.create({ data: { userId: user.id, organizationId: org, role: 'RECRUITER' } });
  session.current = { user: { id: user.id, orgId: org } };
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('POST /api/applications', () => {
  it('adds a candidate to a job at the chosen stage', async () => {
    const res = await post({ jobId: job, candidateId: cand, stage: 'SCREENED' });
    expect(res.status).toBe(201);
    const a = await db.application.findFirstOrThrow({ where: { jobId: job, candidateId: cand } });
    expect(a).toMatchObject({ organizationId: org, stage: 'SCREENED', maxStage: 'SCREENED' });
  });

  it('refuses a duplicate with a friendly message', async () => {
    const res = await post({ jobId: job, candidateId: cand });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Already in this job’s pipeline.');
  });

  it('rejects stages you cannot start at', async () => {
    expect((await post({ jobId: job, candidateId: cand2, stage: 'PLACED' })).status).toBe(400);
  });

  it('cannot add to another org’s job', async () => {
    expect((await post({ jobId: otherJob, candidateId: cand2 })).status).toBe(404);
  });
});

describe('PATCH /api/applications/[id]', () => {
  it('requires a rejection reason, and keeps the furthest stage when rejecting', async () => {
    const a = await db.application.findFirstOrThrow({ where: { jobId: job, candidateId: cand } });
    await patch(a.id, { stage: 'INTERVIEW' });
    const missing = await patch(a.id, { stage: 'REJECTED' });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toMatch(/rejection reason is required/);
    expect((await patch(a.id, { stage: 'REJECTED', rejectionReason: 'Client declined' })).status).toBe(200);
    expect(await db.application.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ stage: 'REJECTED', maxStage: 'INTERVIEW', rejectionReason: 'Client declined' });
  });

  it('placing the last opening puts the candidate on assignment and fills the job', async () => {
    const created = await post({ jobId: job, candidateId: cand2, stage: 'INTERVIEW' });
    const { id } = await created.json();
    expect((await patch(id, { stage: 'PLACED' })).status).toBe(200);
    expect((await db.candidate.findUniqueOrThrow({ where: { id: cand2 } })).status).toBe('On assignment');
    expect((await db.job.findUniqueOrThrow({ where: { id: job } })).status).toBe('FILLED');
  });
});
