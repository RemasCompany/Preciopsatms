import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (m: { to: string; subject: string }) => { mail.sent.push(m); return { id: 'e' }; }) }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { AUTO_TYPE, indexLeie, matchWorker, parseLeie } from '@/lib/exclusions';
import { runExclusionScreening } from '@/lib/exclusions-server';
import { PATCH as SETTINGS } from '@/app/api/credentials/exclusions/route';
import { PATCH as REVIEW } from '@/app/api/credentials/exclusions/[id]/route';
import { POST as SHIFT } from '@/app/api/shifts/route';

// The real file's header row, and a few made-up people.
const HEADER = 'LASTNAME,FIRSTNAME,MIDNAME,BUSNAME,GENERAL,SPECIALTY,UPIN,NPI,DOB,ADDRESS,CITY,STATE,ZIP,EXCLTYPE,EXCLDATE,REINDATE,WAIVERDATE,WVRSTATE';
const LEIE = [HEADER,
  'RUIZ,ANA,M,,NURSING,NURSE/NURSES AIDE,,0000000000,19800312,1 MAIN ST,MIAMI,FL,33101,1128a1,20190601,00000000,00000000,',
  'SMITH,JOHN,,,PHYSICIAN,FAMILY PRACTICE,,1234567893,19700101,2 ELM,AUSTIN,TX,78701,1128b4,20200115,00000000,00000000,',
  ',,,"ACME HOME HEALTH, LLC",OTHER BUSINESS,HOME HEALTH,,0000000000,00000000,3 OAK,TAMPA,FL,33601,1128b7,20210101,00000000,00000000,',
  'GARCIA-LOPEZ,MARIA,,,NURSING,RN,,0000000000,19851111,,ORLANDO,FL,32801,1128a1,20220202,00000000,00000000,',
].join('\r\n');

describe('reading and matching the OIG list', () => {
  const list = parseLeie(LEIE);
  it('keeps individuals and skips businesses', () => {
    expect(list.map((l) => l.name)).toEqual(['ANA M RUIZ', 'JOHN SMITH', 'MARIA GARCIA-LOPEZ']);
    expect(list[0]).toMatchObject({ npi: null, dob: '19800312', place: 'MIAMI, FL', exclType: '1128a1' });
    expect(list[1].npi).toBe('1234567893');
  });
  it('matches on first and last name (accents, hyphens and two-part surnames included) or on NPI', () => {
    const idx = indexLeie(list);
    expect(matchWorker({ name: 'Ana Ruiz', npis: [] }, idx).map((h) => h.on)).toEqual(['name']);
    expect(matchWorker({ name: 'Ána  Ruíz', npis: [] }, idx)).toHaveLength(1);
    expect(matchWorker({ name: 'Maria Garcia Lopez', npis: [] }, idx)).toHaveLength(1);
    expect(matchWorker({ name: 'J. Smithers', npis: ['1234567893'] }, idx).map((h) => h.on)).toEqual(['npi']);
    expect(matchWorker({ name: 'Ana Rivera', npis: [] }, idx)).toEqual([]);
    expect(matchWorker({ name: 'Cher', npis: [] }, idx)).toEqual([]);
  });
  it('refuses a file in a layout it doesn’t know', () => {
    expect(() => parseLeie('A,B\n1,2')).toThrow(/unexpected layout/);
  });
});

const RUN = `ex${Date.now()}`;
let org: string, off: string, owner: string, rec: string, ana: string, ben: string, anaApp: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const json = (method: string, body?: unknown) => new Request('http://x', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const leie = vi.fn(async () => new Response(LEIE, { headers: { 'last-modified': 'Tue, 13 Oct 2026 00:00:00 GMT' } }));

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Sunrise Nurses', slug: `s-${RUN}`, plan: 'growth', subscriptionStatus: 'active', timezone: 'UTC' } })).id;
  off = (await db.organization.create({ data: { name: 'Not Screening', slug: `n-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  owner = await u('owner'); rec = await u('rec');
  await db.membership.createMany({ data: [{ userId: owner, organizationId: org, role: 'OWNER' }, { userId: rec, organizationId: org, role: 'RECRUITER' }] });
  const t = tenantDb(org);
  const job = await t.job.create({ data: { title: 'RN', type: 'CONTRACT' } as never });
  ana = (await t.candidate.create({ data: { name: 'Ana Ruiz' } as never })).id;
  ben = (await t.candidate.create({ data: { name: 'Ben Ortiz' } as never })).id;
  await t.candidate.create({ data: { name: 'John Smith' } as never }); // not working anywhere: not screened
  anaApp = (await t.application.create({ data: { candidateId: ana, jobId: job.id, stage: 'PLACED' } as never })).id;
  await t.application.create({ data: { candidateId: ben, jobId: job.id, stage: 'PLACED' } as never });
  const ot = tenantDb(off);
  const oj = await ot.job.create({ data: { title: 'RN', type: 'CONTRACT' } as never });
  const oc = await ot.candidate.create({ data: { name: 'Ana Ruiz' } as never });
  await ot.application.create({ data: { candidateId: oc.id, jobId: oj.id, stage: 'PLACED' } as never });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('monthly exclusion screening', () => {
  it('is turned on by an owner or admin', async () => {
    as(rec);
    expect((await SETTINGS(json('PATCH', { enabled: true }))).status).toBe(403);
    as(owner);
    expect((await SETTINGS(json('PATCH', { enabled: true }))).status).toBe(200);
    expect(await db.auditLog.count({ where: { organizationId: org, action: 'exclusion.settings' } })).toBe(1);
  });

  it('screens workers once, raises a possible match for review and renews everyone else', async () => {
    const r = await runExclusionScreening(new Date(), leie as unknown as typeof fetch);
    expect(r).toMatchObject({ companies: 1, workers: 2, newMatches: 1, asOf: '2026-10-13' });
    const t = tenantDb(org);
    const m = await t.exclusionMatch.findMany();
    expect(m.map((x) => [x.candidateId, x.listedName, x.status, x.matchedOn])).toEqual([[ana, 'ANA M RUIZ', 'OPEN', 'name']]);
    const creds = await t.credential.findMany({ where: { type: AUTO_TYPE } });
    expect(creds.map((c) => c.candidateId)).toEqual([ben]); // Ana's isn't renewed while her match is open
    expect(creds[0].verifiedAt).not.toBeNull();
    expect(mail.sent.map((x) => x.to)).toEqual([`owner@${RUN}.test`]); // admins only
    expect(await tenantDb(off).exclusionMatch.count()).toBe(0); // a company that hasn't turned it on isn't screened
    // Nothing is due again until next month.
    expect(await runExclusionScreening(new Date(), leie as unknown as typeof fetch)).toEqual({ companies: 0 });
  });

  it('a cleared match renews the screening and isn’t raised again', async () => {
    const t = tenantDb(org);
    const m = (await t.exclusionMatch.findFirst({ where: { candidateId: ana } }))!;
    as(rec);
    expect((await REVIEW(json('PATCH', { decision: 'CLEARED', note: 'OIG search: SSN does not match' }), { params: { id: m.id } })).status).toBe(403);
    as(owner);
    expect((await REVIEW(json('PATCH', { decision: 'CLEARED', note: 'no' }), { params: { id: m.id } })).status).toBe(400);
    expect((await REVIEW(json('PATCH', { decision: 'CLEARED', note: 'OIG search: SSN does not match' }), { params: { id: m.id } })).status).toBe(200);
    expect(await t.credential.count({ where: { candidateId: ana, type: AUTO_TYPE, verifiedAt: { not: null } } })).toBe(1);
    await db.organization.update({ where: { id: org }, data: { exclusionScreenedAt: new Date(Date.now() - 40 * 864e5) } });
    expect((await runExclusionScreening(new Date(), leie as unknown as typeof fetch)).newMatches).toBe(0);
  });

  it('a confirmed match puts them on the do-not-return list, which stops scheduling them', async () => {
    const t = tenantDb(org);
    await t.exclusionMatch.updateMany({ where: { candidateId: ana }, data: { status: 'OPEN' } });
    const m = (await t.exclusionMatch.findFirst({ where: { candidateId: ana } }))!;
    as(owner);
    expect((await REVIEW(json('PATCH', { decision: 'CONFIRMED', note: 'OIG search: SSN matches' }), { params: { id: m.id } })).status).toBe(200);
    expect((await REVIEW(json('PATCH', { decision: 'CLEARED', note: 'changed my mind' }), { params: { id: m.id } })).status).toBe(409);
    const dnr = await t.doNotReturn.findFirst({ where: { candidateId: ana, liftedAt: null } });
    expect([dnr?.clientId, dnr?.source]).toEqual([null, 'exclusion screening']);
    expect(await t.credential.count({ where: { candidateId: ana, type: AUTO_TYPE, verifiedAt: { not: null } } })).toBe(0);
    const r = await SHIFT(json('POST', { applicationId: anaApp, dates: [new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10)], start: '07:00', end: '15:00', breakMinutes: 0 }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/do-not-return list \(On the OIG exclusion list/);
  });

  it('another company can’t review this company’s matches', async () => {
    const m = (await tenantDb(org).exclusionMatch.findFirst())!;
    await db.membership.create({ data: { userId: owner, organizationId: off, role: 'OWNER' } });
    as(owner, off);
    expect((await REVIEW(json('PATCH', { decision: 'CLEARED', note: 'trying from elsewhere' }), { params: { id: m.id } })).status).toBe(404);
  });
});
