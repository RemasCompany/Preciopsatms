import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { suggestRequirements } from '@/lib/requirements';
import { PATCH as SETTINGS } from '@/app/api/org/route';
import { POST as ADD_RECORD } from '@/app/api/records/[kind]/route';
import { POST as ADD_JOB } from '@/app/api/jobs/route';
import { POST as STANDARD } from '@/app/api/pay-rules/standard/route';

describe('requirements suggested from a job title', () => {
  it('reads the nursing role and specialty', () => {
    expect(suggestRequirements('ICU RN – Nights')).toEqual(['RN license', 'BLS', 'ACLS', 'TB test', 'Background check', 'Drug screen', 'OIG / SAM exclusion check']);
    expect(suggestRequirements('Registered Nurse, Emergency Dept')).toContain('ACLS');
    expect(suggestRequirements('L&D Nurse')).toContain('NRP');
    expect(suggestRequirements('NICU RN')).toEqual(expect.arrayContaining(['PALS', 'NRP']));
    expect(suggestRequirements('Med-Surg RN')).toEqual(['RN license', 'BLS', 'TB test', 'Background check', 'Drug screen', 'OIG / SAM exclusion check']);
    expect(suggestRequirements('LPN – Long-term care')[0]).toBe('LPN / LVN license');
    expect(suggestRequirements('Certified Nursing Assistant')[0]).toBe('CNA certification');
  });
  it('suggests nothing for other jobs, or for nurse practitioners (whose license isn’t covered)', () => {
    expect(suggestRequirements('Forklift Operator')).toEqual([]);
    expect(suggestRequirements('Medical Assistant')).toEqual([]);
    expect(suggestRequirements('Nurse Practitioner')).toEqual([]);
    expect(suggestRequirements('Warehouse Associate (Learning)')).toEqual([]); // "rn" inside a word doesn't count
  });
});

const RUN = `hi${Date.now()}`;
let care: string, general: string, emp: string, owner: string, rec: string;
const as = (u: string, o: string) => { session.current = { user: { id: u, orgId: o } }; };
const json = (method: string, body?: unknown) => new Request('http://x', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const K = (kind: string) => ({ params: { kind } });

beforeAll(async () => {
  const mk = (n: string, kind: 'STAFFING' | 'EMPLOYER' = 'STAFFING') => db.organization.create({ data: { name: n, slug: `${n.toLowerCase()}-${RUN}`, plan: 'growth', subscriptionStatus: 'active', kind } }).then((o) => o.id);
  care = await mk('Care'); general = await mk('General'); emp = await mk('Hospital', 'EMPLOYER');
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  owner = await u('owner'); rec = await u('rec');
  await db.membership.createMany({ data: [care, general, emp].flatMap((o) => [{ userId: owner, organizationId: o, role: 'OWNER' as const }, { userId: rec, organizationId: o, role: 'RECRUITER' as const }]) });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('the healthcare setting', () => {
  it('is set by an admin from Settings and audited', async () => {
    as(rec, care);
    expect((await SETTINGS(json('PATCH', { industry: 'HEALTHCARE' }))).status).toBe(403);
    as(owner, care);
    expect((await (await SETTINGS(json('PATCH', { industry: 'DENTAL' }))).json()).error).toBe('Choose your industry.');
    expect((await SETTINGS(json('PATCH', { industry: 'HEALTHCARE' }))).status).toBe(200);
    as(owner, emp);
    expect((await SETTINGS(json('PATCH', { industry: 'HEALTHCARE' }))).status).toBe(200);
    expect((await db.organization.findUnique({ where: { id: care } }))!.industry).toBe('HEALTHCARE');
    expect(await db.auditLog.count({ where: { organizationId: care, action: 'settings.company', summary: { contains: 'industry' } } })).toBe(1);
  });

  it('starts new nursing jobs with the usual requirements, only for healthcare companies', async () => {
    as(rec, care);
    const r = await ADD_RECORD(json('POST', { title: 'ICU RN', type: 'CONTRACT', location: 'Tampa, FL' }), K('jobs'));
    expect(r.status).toBe(201);
    expect((await tenantDb(care).job.findFirst({ where: { id: (await r.json()).id } }))!.requiredCerts).toContain('ACLS');
    const api = await (await ADD_JOB(json('POST', { title: 'CNA – Days', type: 'TEMP' }))).json();
    expect(api.job.requiredCerts[0]).toBe('CNA certification');
    const other = await ADD_RECORD(json('POST', { title: 'Forklift Operator', type: 'TEMP' }), K('jobs'));
    expect((await tenantDb(care).job.findFirst({ where: { id: (await other.json()).id } }))!.requiredCerts).toEqual([]);
    as(rec, general);
    const g = await ADD_RECORD(json('POST', { title: 'ICU RN', type: 'CONTRACT' }), K('jobs'));
    expect((await tenantDb(general).job.findFirst({ where: { id: (await g.json()).id } }))!.requiredCerts).toEqual([]);
  });

  it('adds the usual differentials once, without bill rates for an employer', async () => {
    as(rec, care);
    expect((await STANDARD()).status).toBe(403);
    as(owner, care);
    expect((await (await STANDARD()).json()).added).toEqual(['Night shift', 'Weekend', 'Holiday', 'On call']);
    expect((await (await STANDARD()).json()).added).toEqual([]);
    const night = await tenantDb(care).payRule.findFirst({ where: { kind: 'NIGHT' } });
    expect([night!.startTime, night!.endTime, Number(night!.pay), Number(night!.bill)]).toEqual(['19:00', '07:00', 3, 4.5]);
    expect((await tenantDb(care).payRule.findFirst({ where: { kind: 'HOLIDAY' } }))!.holidays).toHaveLength(12);
    as(owner, emp);
    await STANDARD();
    expect((await tenantDb(emp).payRule.findMany()).every((r) => Number(r.bill) === 0)).toBe(true);
  });
});
