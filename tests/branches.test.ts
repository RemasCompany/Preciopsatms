import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { candidateInBranch, currentBranch, jobInBranch } from '@/lib/branches';
import { POST as CREATE } from '@/app/api/records/[kind]/route';
import { GET as SWITCH } from '@/app/api/branch/route';
import { PATCH as HOME } from '@/app/api/team/members/[id]/branch/route';

const RUN = `br${Date.now()}`;
let org: string, other: string, admin: string, rec: string, recMember: string, adminMember: string, north: string, south: string, foreign: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const req = (url: string, method = 'GET', body?: object) => new Request(url, { method, body: body ? JSON.stringify(body) : undefined });

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Multi Office', slug: `m-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  other = (await db.organization.create({ data: { name: 'Other', slug: `o-${RUN}` } })).id;
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [admin, rec] = await Promise.all([u('admin'), u('rec')]);
  adminMember = (await db.membership.create({ data: { userId: admin, organizationId: org, role: 'ADMIN' } })).id;
  recMember = (await db.membership.create({ data: { userId: rec, organizationId: org, role: 'RECRUITER' } })).id;
  foreign = (await db.branch.create({ data: { organizationId: other, name: 'Not yours' } })).id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('branches', () => {
  it('are created by admins only', async () => {
    as(rec);
    expect((await CREATE(req('http://x', 'POST', { name: 'North' }), { params: { kind: 'branches' } })).status).toBe(403);
    as(admin);
    north = (await (await CREATE(req('http://x', 'POST', { name: 'North', city: 'Orlando, FL' }), { params: { kind: 'branches' } })).json()).id;
    south = (await (await CREATE(req('http://x', 'POST', { name: 'South' }), { params: { kind: 'branches' } })).json()).id;
    expect(await db.branch.count({ where: { organizationId: org } })).toBe(2);
  });

  it('filter jobs and candidates', async () => {
    const tdb = tenantDb(org);
    const jN = await db.job.create({ data: { organizationId: org, title: 'North job', branchId: north } });
    await db.job.create({ data: { organizationId: org, title: 'South job', branchId: south } });
    await db.candidate.create({ data: { organizationId: org, name: 'Home North', branchId: north } });
    const viaJob = await db.candidate.create({ data: { organizationId: org, name: 'Applied North' } });
    await db.application.create({ data: { organizationId: org, candidateId: viaJob.id, jobId: jN.id } });
    await db.candidate.create({ data: { organizationId: org, name: 'Elsewhere' } });
    expect((await tdb.job.findMany({ where: jobInBranch({ id: north }) })).map((j) => j.title)).toEqual(['North job']);
    expect((await tdb.candidate.findMany({ where: candidateInBranch({ id: north }), orderBy: { name: 'asc' } })).map((c) => c.name)).toEqual(['Applied North', 'Home North']);
    expect(await tdb.job.count({ where: jobInBranch(null) })).toBe(2);
  });

  it('the switcher remembers a valid branch of this company only, and only redirects inside the app', async () => {
    as(rec);
    const r = await SWITCH(req(`http://x?id=${north}&back=/app/jobs?status=OPEN`));
    expect([r.status, r.headers.get('location')]).toEqual([303, '/app/jobs?status=OPEN']);
    expect(r.headers.get('set-cookie')).toContain(`preci_branch=${north}`);
    expect((await SWITCH(req(`http://x?id=${foreign}`))).headers.get('set-cookie')).toContain('preci_branch=all');
    expect((await SWITCH(req('http://x?id=all&back=https://evil.test'))).headers.get('location')).toBe('/app');
  });

  it('home branch: people set their own; admins set anyone’s; it’s the default', async () => {
    as(rec);
    expect((await HOME(req('http://x', 'PATCH', { branchId: south }), { params: { id: adminMember } })).status).toBe(403);
    expect((await HOME(req('http://x', 'PATCH', { branchId: foreign }), { params: { id: recMember } })).status).toBe(404);
    expect((await HOME(req('http://x', 'PATCH', { branchId: south }), { params: { id: recMember } })).status).toBe(200);
    const ctx = { tdb: tenantDb(org), org: { id: org }, user: { id: rec } };
    expect((await currentBranch(ctx)).branch).toMatchObject({ id: south, name: 'South' });
    as(admin);
    expect((await HOME(req('http://x', 'PATCH', { branchId: null }), { params: { id: recMember } })).status).toBe(200);
    expect((await currentBranch(ctx)).branch).toBeNull();
  });
});
