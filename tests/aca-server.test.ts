import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { overview, form1095Csv, hoursByPerson } from '@/lib/aca-server';
import { PATCH as POLICY } from '@/app/api/aca/policy/route';
import { POST as OFFER } from '@/app/api/aca/offers/route';
import { PATCH as RESPOND } from '@/app/api/aca/offers/[id]/route';
import { GET as EXPORT } from '@/app/api/aca/1095/route';

const RUN = `aca${Date.now()}`;
const TODAY = '2026-10-17';
let org: string, other: string, starter: string, admin: string, rec: string, oUser: string, sUser: string;
const ids: Record<string, string> = {};
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const req = (method: string, body?: object, url = 'http://x') => new Request(url, { method, body: body ? JSON.stringify(body) : undefined });

/** Approved weekly timesheets of `hours` from week-ending `from` up to `to`. */
async function weeks(applicationId: string, from: string, to: string, hours: number) {
  const data = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 7 * 864e5) data.push({ organizationId: org, applicationId, weekEnding: new Date(t), regularHours: hours, payRate: 18, billRate: 27, status: 'APPROVED' as const });
  await db.timesheet.createMany({ data });
}

beforeAll(async () => {
  const mk = (n: string, plan: 'growth' | 'starter') => db.organization.create({ data: { name: n, slug: `${n}-${RUN}`, plan, subscriptionStatus: 'active' } }).then((o) => o.id);
  [org, other, starter] = await Promise.all([mk('acme', 'growth'), mk('other', 'growth'), mk('small', 'starter')]);
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [admin, rec, oUser, sUser] = await Promise.all([u('admin'), u('rec'), u('other'), u('small')]);
  await db.membership.createMany({ data: [{ userId: admin, organizationId: org, role: 'ADMIN' }, { userId: rec, organizationId: org, role: 'RECRUITER' }, { userId: oUser, organizationId: other, role: 'OWNER' }, { userId: sUser, organizationId: starter, role: 'OWNER' }] });
  const job = await db.job.create({ data: { organizationId: org, title: 'Packer', payRate: 18, billRate: 27 } });
  for (const [key, name] of [['steady', 'Ana Steady'], ['newbie', 'Ben New'], ['close', 'Cara Close'], ['salaried', 'Dee Salary']]) {
    ids[key] = (await db.candidate.create({ data: { organizationId: org, name } })).id;
    ids[`${key}App`] = (await db.application.create({ data: { organizationId: org, candidateId: ids[key], jobId: job.id, stage: 'PLACED' } })).id;
  }
  await weeks(ids.steadyApp, '2024-01-07', '2026-10-11', 35);
  await weeks(ids.newbieApp, '2026-03-15', '2026-10-11', 33);
  await weeks(ids.closeApp, '2024-01-07', '2026-10-11', 28);
  await db.employee.create({ data: { organizationId: org, candidateId: ids.salaried, title: 'Office manager', startDate: new Date('2024-01-01'), payType: 'SALARY', payRate: 60000 } });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('ACA overview', () => {
  it('finds who is full-time, who is heading there, and who is close', async () => {
    const o = await overview(tenantDb(org), TODAY);
    const by = Object.fromEntries(o.rows.map((r) => [r.name, r]));
    expect(by['Ana Steady']).toMatchObject({ kind: 'ongoing', now: { status: 'full_time' }, fullTimeThrough: '2026-12-31', action: 'offer_now' });
    expect(by['Dee Salary']).toMatchObject({ kind: 'ongoing', now: { status: 'full_time' }, action: 'offer_now' }); // 40 h/week credited
    expect(by['Ben New']).toMatchObject({ kind: 'new', now: { status: 'measuring' }, action: 'offer_soon', offerBy: '2027-05-01' });
    expect(by['Ben New'].actionText).toBe('Averaging 33.0 hours a week. If that holds, offer coverage starting 2027-05-01.');
    expect(by['Cara Close']).toMatchObject({ now: { status: 'not_full_time' }, action: 'watch', offerBy: '2027-01-01' });
    expect(o.rows.map((r) => r.action)).toEqual(['offer_now', 'offer_now', 'offer_soon', 'watch']); // most urgent first
    expect(o.counts).toEqual({ offerNow: 2, offerSoon: 1, watch: 1, fullTime: 2 });
    expect(o.ale).toMatchObject({ priorYear: 2025, ale: false });
  });

  it('keeps each company’s people separate', async () => {
    expect((await overview(tenantDb(other), TODAY)).rows).toEqual([]);
    expect((await hoursByPerson(tenantDb(other), '2024-01-01', TODAY)).size).toBe(0);
  });
});

describe('offers and settings', () => {
  it('records an offer, which clears the alert, and the worker’s answer', async () => {
    as(rec);
    expect((await OFFER(req('POST', { candidateId: ids.steady }))).status).toBe(403);
    as(admin);
    const body = { candidateId: ids.steady, offeredOn: '2025-12-01', coverageStart: '2026-01-01', coverageEnd: '2026-12-31', coverage: 'FAMILY', minimumValue: true, employeeCost: 95, response: 'PENDING' };
    expect((await (await OFFER(req('POST', { ...body, coverageStart: '2026-01-15' }))).json()).error).toBe('Coverage starts on the 1st of a month.');
    expect((await (await OFFER(req('POST', { ...body, coverageEnd: '2025-12-31' }))).json()).error).toBe('Coverage can’t end before it starts.');
    const r = await OFFER(req('POST', body));
    expect(r.status).toBe(201);
    const id = (await r.json()).id;
    // 2026 is covered now; she's still averaging 35, so next year's offer (from Jan 1, 2027) is coming up.
    expect((await overview(tenantDb(org), TODAY)).rows.find((x) => x.name === 'Ana Steady')).toMatchObject({ action: 'offer_soon', offerBy: '2027-01-01', offer: { coverage: 'FAMILY', employeeCost: 95, response: 'PENDING' } });
    expect((await RESPOND(req('PATCH', { response: 'WAIVED', respondedOn: '2025-12-05' }), { params: { id } })).status).toBe(200);
    expect((await db.acaOffer.findUnique({ where: { id } }))?.response).toBe('WAIVED');
    as(oUser, other);
    expect((await RESPOND(req('PATCH', { response: 'ACCEPTED' }), { params: { id } })).status).toBe(404);
    expect((await (await OFFER(req('POST', body))).json()).error).toBe('That person was deleted.');
  });

  it('validates the measurement settings and is on Growth and up', async () => {
    as(admin);
    expect((await (await POLICY(req('PATCH', { measurementMonths: 12, adminMonths: 3, stabilityMonths: 12, startMonth: 11 }))).json()).error).toBe('The administrative period can be up to 2 months (the limit is 90 days).');
    expect((await POLICY(req('PATCH', { measurementMonths: 6, adminMonths: 1, stabilityMonths: 6, startMonth: 1 }))).status).toBe(200);
    expect(await db.acaPolicy.findFirst({ where: { organizationId: org } })).toMatchObject({ measurementMonths: 6, startMonth: 1 });
    await POLICY(req('PATCH', { measurementMonths: 12, adminMonths: 2, stabilityMonths: 12, startMonth: 11 }));
    as(sUser, starter);
    expect((await POLICY(req('PATCH', { measurementMonths: 12, adminMonths: 2, stabilityMonths: 12, startMonth: 11 }))).status).toBe(402);
  });
});

describe('Form 1095-C data', () => {
  it('lists full-time workers with suggested codes for each month', async () => {
    const { csv, people } = await form1095Csv(tenantDb(org), 2026, TODAY);
    const lines = csv.trim().split('\r\n');
    expect(people).toBe(2); // Ana and Dee were full-time; Ben was measuring and Cara under 30
    expect(lines[0].split(',').slice(0, 5)).toEqual(['Employee', 'Employee ID', 'Jan line 14', 'Jan line 15', 'Jan line 16']);
    const ana = lines.find((l) => l.startsWith('Ana Steady'))!.split(',');
    expect(ana.slice(2, 5)).toEqual(['1E', '95.00', '']); // offered family coverage, declined: line 16 left for the safe harbor
    const dee = lines.find((l) => l.startsWith('Dee Salary'))!.split(',');
    expect(dee.slice(2, 5)).toEqual(['1H', '', '']); // full-time, no offer: the filer will see the exposure
    as(admin);
    const r = await EXPORT(req('GET', undefined, 'http://x?year=2026'));
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="1095c-data-2026.csv"');
    expect((await EXPORT(req('GET', undefined, 'http://x?year=2099'))).status).toBe(400);
  });
});
