import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@prisma/client';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { db } from '@/lib/db';
import { HttpError, requireApiContext, tenantDb } from '@/lib/tenant';

const RUN = `t${Date.now()}`;
let orgA: string, orgB: string, jobA: string, jobB: string;

async function makeOrg(tag: string, plan: 'starter' | 'growth' | 'enterprise' = 'growth', subscriptionStatus = 'active') {
  return db.organization.create({ data: { name: `${tag} ${RUN}`, slug: `${tag}-${RUN}`, plan, subscriptionStatus } });
}
async function signInAs(orgId: string, role: Role) {
  const user = await db.user.create({ data: { email: `${role}-${orgId}-${Math.random()}@${RUN}.test`, passwordHash: 'x' } });
  await db.membership.create({ data: { userId: user.id, organizationId: orgId, role } });
  session.current = { user: { id: user.id, orgId } };
}

beforeAll(async () => {
  orgA = (await makeOrg('a')).id; orgB = (await makeOrg('b')).id;
  jobA = (await db.job.create({ data: { organizationId: orgA, title: 'A job' } })).id;
  jobB = (await db.job.create({ data: { organizationId: orgB, title: 'B job' } })).id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});
beforeEach(() => { session.current = null; });

describe('tenantDb isolation', () => {
  it('only lists the caller’s records', async () => {
    const jobs = await tenantDb(orgA).job.findMany();
    expect(jobs.map((j) => j.id)).toEqual([jobA]);
    expect(await tenantDb(orgA).job.count()).toBe(1);
  });

  it('cannot read another org’s record by id', async () => {
    expect(await tenantDb(orgA).job.findFirst({ where: { id: jobB } })).toBeNull();
  });

  it('overrides an organizationId filter pointing at another org', async () => {
    const jobs = await tenantDb(orgA).job.findMany({ where: { organizationId: orgB } });
    expect(jobs.map((j) => j.id)).toEqual([jobA]);
  });

  it('cannot update or delete another org’s record', async () => {
    expect((await tenantDb(orgA).job.updateMany({ where: { id: jobB }, data: { title: 'hacked' } })).count).toBe(0);
    expect((await tenantDb(orgA).job.deleteMany({ where: { id: jobB } })).count).toBe(0);
    const b = await db.job.findUniqueOrThrow({ where: { id: jobB } });
    expect(b.title).toBe('B job');
  });

  it('forces the caller’s org on create, even if the client sends another', async () => {
    const j = await tenantDb(orgA).job.create({ data: { title: 'sneaky', organizationId: orgB } as never });
    expect(j.organizationId).toBe(orgA);
    const many = await tenantDb(orgA).job.createMany({ data: [{ title: 'x1', organizationId: orgB }, { title: 'x2' }] as never });
    expect(many.count).toBe(2);
    expect(await db.job.count({ where: { organizationId: orgB } })).toBe(1);
    await db.job.deleteMany({ where: { organizationId: orgA, id: { not: jobA } } });
  });

  it.each(['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert'] as const)('blocks unscoped %s', async (op) => {
    const args = { where: { id: jobB }, data: { title: 'x' }, create: { title: 'x' }, update: { title: 'x' } };
    const model = tenantDb(orgA).job as unknown as Record<string, (a: unknown) => Promise<unknown>>;
    await expect(model[op](op.startsWith('find') || op === 'delete' ? { where: args.where } : args)).rejects.toThrow(/is not allowed/);
  });
});

describe('requireApiContext gating', () => {
  const expectHttp = async (p: Promise<unknown>, status: number) => {
    const e = await p.catch((x) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).status).toBe(status);
  };

  it('401 when signed out', async () => {
    await expectHttp(requireApiContext(), 401);
  });

  it('401 when the session’s org has no membership for the user', async () => {
    await signInAs(orgA, 'OWNER');
    session.current = { user: { id: session.current!.user.id, orgId: orgB } };
    await expectHttp(requireApiContext(), 401);
  });

  it('returns a tenantDb scoped to the session org', async () => {
    await signInAs(orgB, 'RECRUITER');
    const ctx = await requireApiContext();
    expect(ctx.org.id).toBe(orgB);
    expect((await ctx.tdb.job.findMany()).map((j) => j.id)).toEqual([jobB]);
  });

  it('403 when the role is too low', async () => {
    await signInAs(orgA, 'RECRUITER');
    await expectHttp(requireApiContext({ minRole: 'ADMIN' }), 403);
  });

  it('402 when the plan lacks the feature', async () => {
    await signInAs(orgA, 'OWNER'); // growth plan
    await expectHttp(requireApiContext({ feature: 'eeo' }), 402);
    await expect(requireApiContext({ feature: 'timesheets' })).resolves.toBeTruthy();
  });

  it('402 on writes when the subscription is inactive, but reads still work', async () => {
    const lapsed = await makeOrg('lapsed', 'growth', 'past_due');
    await signInAs(lapsed.id, 'OWNER');
    await expectHttp(requireApiContext({ write: true }), 402);
    await expect(requireApiContext()).resolves.toBeTruthy();
  });
});
