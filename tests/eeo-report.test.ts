import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { buildEeoReport, cleanEeoAnswer } from '@/lib/eeo';
import { GET as EXPORT } from '@/app/api/eeo/export/route';
import { GET as REPORT } from '@/app/api/eeo/report/route';

const RUN = `q${Date.now()}`;
let org: string, admin: string, recruiter: string, job: string;

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'E', slug: `q-${RUN}`, plan: 'enterprise', subscriptionStatus: 'active' } })).id;
  job = (await db.job.create({ data: { organizationId: org, title: 'Driver' } })).id;
  // 4 women (1 hired), 4 men (2 hired), 1 declined, 1 no answer; one rejection without a reason.
  const people: [string, string | null, 'PLACED' | 'INTERVIEW' | 'APPLIED' | 'REJECTED', string | null][] = [
    ['F1', 'Female', 'PLACED', null], ['F2', 'Female', 'INTERVIEW', null], ['F3', 'Female', 'REJECTED', 'Client declined'], ['F4', 'Female', 'APPLIED', null],
    ['M1', 'Male', 'PLACED', null], ['M2', 'Male', 'PLACED', null], ['M3', 'Male', 'REJECTED', null], ['M4', 'Male', 'APPLIED', null],
    ['D1', 'Decline to self-identify', 'APPLIED', null], ['N1', null, 'APPLIED', null],
  ];
  for (const [name, gender, stage, reason] of people) {
    const c = await db.candidate.create({ data: { organizationId: org, name } });
    await db.application.create({ data: { organizationId: org, jobId: job, candidateId: c.id, stage, maxStage: stage === 'REJECTED' ? 'SCREENED' : stage, rejectionReason: reason } });
    if (gender) await db.eeoSelfId.create({ data: { organizationId: org, candidateId: c.id, gender } });
  }
  for (const [role, set] of [['ADMIN', (id: string) => (admin = id)], ['RECRUITER', (id: string) => (recruiter = id)]] as const) {
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

describe('EEO report', () => {
  it('builds applicant flow, four-fifths ratios and dispositions', async () => {
    const r = await buildEeoReport(tenantDb(org), {});
    expect(r).toMatchObject({ applicants: 10, hired: 3, missingReason: 1, dispositionReasons: { 'Client declined': 1 } });
    expect(r.selfIdRate).toBeCloseTo(8 / 10);
    expect(r.report.gender.map((g) => g.group)).toEqual(['Female', 'Male']); // prototype order, declines excluded
    const [f, m] = r.report.gender;
    expect(f).toMatchObject({ applicants: 4, interviewed: 2, hired: 1, selectionRate: 0.25, impactRatio: 0.5, flagged: true });
    expect(m).toMatchObject({ applicants: 4, hired: 2, impactRatio: 1, flagged: false });
    expect(r.report.race).toEqual([]);
  });

  it('filters by year', async () => {
    expect((await buildEeoReport(tenantDb(org), { year: 1999 })).applicants).toBe(0);
  });

  it('is admin-only and exports one row per application', async () => {
    session.current = { user: { id: recruiter, orgId: org } };
    expect((await EXPORT(new Request('http://x'))).status).toBe(403);
    expect((await REPORT(new Request('http://x'))).status).toBe(403);
    session.current = { user: { id: admin, orgId: org } };
    const csv = (await (await EXPORT(new Request(`http://x?job=${job}`))).text()).split('\n');
    expect(csv).toHaveLength(11);
    expect(csv[0]).toBe('Applicant ID,Applicant name,Job ID,Job title,Applied,Furthest stage,Current stage,Disposition reason,Disposition date,Gender,Race/ethnicity,Veteran,Disability');
    const f3 = csv.find((l) => l.includes(',F3,'))!.split(',');
    expect(f3.slice(5, 8)).toEqual(['Screened', 'Rejected', 'Client declined']);
    expect(f3[9]).toBe('Female');
  });

  it('keeps only offered self-ID answers', () => {
    expect(cleanEeoAnswer('gender', 'Female')).toBe('Female');
    expect(cleanEeoAnswer('gender', 'Robot')).toBeUndefined();
    expect(cleanEeoAnswer('race', 42)).toBeUndefined();
  });
});
