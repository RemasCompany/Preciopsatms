import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const out = vi.hoisted(() => ({ emails: [] as { to: string; subject: string }[], texts: [] as { to: string; body: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (m: { to: string; subject: string }) => { out.emails.push(m); return { id: 'e' }; }) }));
vi.mock('@/lib/sms', () => ({ sendSms: vi.fn(async (to: string, body: string) => { out.texts.push({ to, body }); return { id: 's' }; }), toE164: (s: string) => s }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { pickSlots, AUTOMATION_DEFAULTS } from '@/lib/automation';
import { autoPosting } from '@/lib/postings';
import { onApplied } from '@/lib/automation-server';
import { PATCH as SAVE } from '@/app/api/settings/automation/route';
import { PATCH as MOVE } from '@/app/api/applications/[id]/route';

describe('automation rules', () => {
  it('offers weekday times inside interview hours, two a day at most, around the interviewer’s bookings', () => {
    const thu = new Date('2026-11-05T15:00:00Z'); // a Thursday, 10 am in New York
    const cfg = { from: '09:00', to: '17:00', durationMin: 30, count: 4 };
    expect(pickSlots(thu, 'America/New_York', cfg)).toEqual(['2026-11-06T09:00', '2026-11-06T14:00', '2026-11-09T09:00', '2026-11-09T14:00']);
    // Booked at 9 on Friday: the next half hour instead.
    const busy = [{ start: new Date('2026-11-06T14:00:00Z'), minutes: 60 }];
    expect(pickSlots(thu, 'America/New_York', cfg, busy).slice(0, 2)).toEqual(['2026-11-06T10:00', '2026-11-06T14:00']);
    expect(pickSlots(thu, 'America/New_York', { ...cfg, from: '16:50', to: '17:00' })).toEqual([]);
  });
  it('writes a job ad from the job’s details', () => {
    const ad = autoPosting({ title: 'Forklift Operator', location: 'Tampa, FL', remote: false, type: 'TEMP', payRate: 18.5, skills: ['Forklift', 'RF scanner'], requiredCerts: ['Forklift – order picker'], startDate: new Date('2026-12-01T00:00:00Z'), sector: 'Warehouse', openings: 3 },
      { name: 'Acme Staffing LLC', shortName: 'Acme', showPayOnCareers: true });
    expect(ad).toContain('Acme is hiring 3 people for Forklift Operator (in Tampa, FL) — a temporary role in warehouse.');
    expect(ad).toContain('Pay: $18.50 an hour.');
    expect(ad).toContain('What you’ll bring: Forklift and RF scanner.');
    expect(ad).toContain('Start date: December 1, 2026.');
    expect(autoPosting({ title: 'Clerk', location: null, remote: false, type: 'FULL_TIME', payRate: 20, skills: [], startDate: null }, { name: 'Acme', shortName: null, showPayOnCareers: false })).not.toContain('Pay');
  });
});

const RUN = `au${Date.now()}`;
let org: string, owner: string, rec: string, job: string, pkg: string, mgr: string, dept: string;
const as = (u: string) => { session.current = { user: { id: u, orgId: org } }; };
const json = (method: string, body?: unknown) => new Request('http://x', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const settings = (over: object = {}) => ({ ...AUTOMATION_DEFAULTS, screen: { on: true, advanceAt: 60 }, interviews: { ...AUTOMATION_DEFAULTS.interviews, on: true, interviewerId: rec }, onboarding: { on: true, packageId: pkg }, channels: ['email'], ...over });
const orgRow = () => db.organization.findUniqueOrThrow({ where: { id: org } });
const apply = async (name: string, c: object) => {
  const t = tenantDb(org);
  const cand = await t.candidate.create({ data: { name, email: `${name.split(' ')[0].toLowerCase()}@x.test`, ...c } as never });
  return (await t.application.create({ data: { candidateId: cand.id, jobId: job, stage: 'APPLIED', maxStage: 'APPLIED' } as never })).id;
};

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Bayside Health', slug: `b-${RUN}`, plan: 'growth', subscriptionStatus: 'active', kind: 'EMPLOYER', timezone: 'America/New_York' } })).id;
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  owner = await u('owner'); rec = await u('rec');
  await db.membership.createMany({ data: [{ userId: owner, organizationId: org, role: 'OWNER' }, { userId: rec, organizationId: org, role: 'RECRUITER' }] });
  const t = tenantDb(org);
  dept = (await t.department.create({ data: { name: 'Warehouse' } as never })).id;
  const mc = await t.candidate.create({ data: { name: 'Maria Manager' } as never });
  mgr = (await t.employee.create({ data: { candidateId: mc.id, title: 'Warehouse Manager', departmentId: dept, startDate: new Date('2020-01-01T00:00:00Z'), payType: 'SALARY', payRate: 70000, employeeNumber: '1040' } as never })).id;
  job = (await t.job.create({ data: { title: 'Forklift Operator', type: 'FULL_TIME', location: 'Tampa, FL', payRate: 19, skills: ['Forklift', 'RF scanner', 'Inventory'], managerId: mgr } as never })).id;
  pkg = (await t.onboardingPackage.create({ data: { name: 'New hire', steps: [{ kind: 'FORM', label: 'Add an emergency contact', form: 'emergency_contact', required: true }] } as never })).id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('hiring automations', () => {
  it('are set by an owner or admin, and checked', async () => {
    as(rec);
    expect((await SAVE(json('PATCH', settings()))).status).toBe(403);
    as(owner);
    expect((await (await SAVE(json('PATCH', settings({ interviews: { ...AUTOMATION_DEFAULTS.interviews, on: true, interviewerId: null } })))).json()).error).toBe('Choose who interviews.');
    expect((await (await SAVE(json('PATCH', settings({ channels: [] })))).json()).error).toMatch(/how candidates hear from you/);
    expect((await SAVE(json('PATCH', settings()))).status).toBe(200);
    expect(await db.auditLog.count({ where: { organizationId: org, action: 'settings.automation' } })).toBe(1);
  });

  it('screens a strong applicant and sends them interview times; a weak one waits for a person', async () => {
    const strong = await apply('Ana Ruiz', { title: 'Forklift Operator', skills: ['Forklift', 'RF scanner', 'Inventory'], location: 'Tampa, FL', yearsExp: 5, availability: 'Immediately' });
    const r = await onApplied(await orgRow(), strong);
    expect(r?.screened).toBe(true);
    const t = tenantDb(org);
    const iv = await t.interview.findFirst({ where: { applicationId: strong } });
    expect([iv?.status, (iv?.slots as string[]).length, iv?.interviewerIds]).toEqual(['PROPOSED', 4, [rec]]);
    expect((await t.application.findFirst({ where: { id: strong } }))!.stage).toBe('INTERVIEW');
    expect(out.emails.some((e) => e.to === 'ana@x.test' && /pick a time/.test(e.subject))).toBe(true);
    const weak = await apply('Ben Ortiz', { title: 'Barista', location: 'Denver, CO' });
    expect((await onApplied(await orgRow(), weak))?.screened).toBe(false);
    expect((await t.application.findFirst({ where: { id: weak } }))!.stage).toBe('APPLIED'); // never rejected automatically
    expect(await t.interview.count({ where: { applicationId: weak } })).toBe(0);
  });

  it('starts onboarding at the offer, then hiring fills the employee record with no retyping', async () => {
    const t = tenantDb(org);
    const app = (await t.application.findFirst({ where: { candidate: { name: 'Ana Ruiz' } } }))!;
    as(rec);
    expect((await MOVE(json('PATCH', { stage: 'OFFER' }), { params: { id: app.id } })).status).toBe(200);
    const ob = await t.onboarding.findFirst({ where: { applicationId: app.id } });
    expect(ob?.packageName).toBe('New hire');
    expect(out.emails.some((e) => e.to === 'ana@x.test' && /new-hire paperwork/.test(e.subject))).toBe(true);
    // She fills in her emergency contact on her phone…
    await t.onboardingStep.updateMany({ where: { onboardingId: ob!.id, kind: 'FORM' }, data: { status: 'DONE', completedAt: new Date(), data: { name: 'Luis Ruiz', relationship: 'Brother', phone: '813-555-0100' } } });
    // …and is hired.
    expect((await MOVE(json('PATCH', { stage: 'PLACED' }), { params: { id: app.id } })).status).toBe(200);
    const e = await t.employee.findFirst({ where: { candidateId: app.candidateId } });
    expect(e).toMatchObject({ title: 'Forklift Operator', managerId: mgr, departmentId: dept, employeeNumber: '1041', emergencyName: 'Luis Ruiz', emergencyRelation: 'Brother', emergencyPhone: '813-555-0100' });
    expect(Number(e!.payRate)).toBe(19);
  });

  it('notes in Activity when an automation can’t finish, without blocking the move', async () => {
    const t = tenantDb(org);
    const app = await apply('Cara Diaz', { title: 'Forklift Operator', skills: ['Forklift', 'RF scanner', 'Inventory'], location: 'Tampa, FL', yearsExp: 5 });
    await t.onboardingPackage.updateMany({ where: { id: pkg }, data: { archived: true } });
    as(rec);
    expect((await MOVE(json('PATCH', { stage: 'OFFER' }), { params: { id: app } })).status).toBe(200);
    expect(await db.activity.count({ where: { organizationId: org, text: { contains: 'Automation couldn’t start onboarding' } } })).toBe(1);
  });
});
