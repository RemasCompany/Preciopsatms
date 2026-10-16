import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { scoreMatch, yearsWanted, band, type MatchCandidate, type MatchJob } from '@/lib/match';
import { rankForJob, rankJobsFor, scoreApplications } from '@/lib/match-server';
import { GET as JOB_MATCHES } from '@/app/api/jobs/[id]/matches/route';
import { GET as CAND_MATCHES } from '@/app/api/candidates/[id]/matches/route';

const job = (o: Partial<MatchJob> = {}): MatchJob => ({ title: 'Forklift Operator', skills: ['Forklift', 'Pallet jack', 'RF scanner', 'Inventory'], requiredCerts: ['Forklift'],
  sector: 'Warehouse', location: 'Austin, TX', remote: false, payRate: 21, description: 'Load trailers. 2+ years of warehouse experience.', ...o });
const cand = (o: Partial<MatchCandidate> = {}): MatchCandidate => ({ title: 'Forklift Operator', skills: ['Forklift', 'Pallet Jacks', 'RF Scanners', 'Inventory'], certs: [], summary: null,
  sector: 'Warehouse', location: 'Austin, TX', yearsExp: 4, desiredRate: 20, availability: 'Immediately', credentials: ['Forklift'], ...o });
const pts = (m: ReturnType<typeof scoreMatch>, k: string) => m.factors.find((f) => f.key === k)!.points;

describe('match scoring', () => {
  it('a perfect fit scores 100, and every factor explains itself', () => {
    const m = scoreMatch(job(), cand());
    expect(m.score).toBe(100);
    expect(m.factors.map((f) => f.max).reduce((a, b) => a + b)).toBe(100);
    expect(m.factors.find((f) => f.key === 'skills')!.note).toBe('4 of 4 required skills');
    expect(m.factors.find((f) => f.key === 'experience')!.note).toBe('4 years · job asks for 2+');
    expect(band(m.score)).toBe('Strong match');
  });

  it('counts listed skills fully and skills only mentioned in the profile half', () => {
    const m = scoreMatch(job(), cand({ skills: ['Forklift'], summary: 'Used an RF scanner daily for inventory counts.' }));
    expect(m.matched).toEqual(['Forklift', 'RF scanner', 'Inventory']);
    expect(m.missing).toEqual(['Pallet jack']);
    expect(pts(m, 'skills')).toBe(20); // 1 + 0.5 + 0.5 of 4 → 2/4 of 40
  });

  it('gives partial credit for a broader skill or the main word', () => {
    const j = job({ skills: ['Sit-down forklift', 'RF scanner'] });
    expect(pts(scoreMatch(j, cand({ skills: ['Forklift'], title: 'Picker' })), 'skills')).toBe(15); // 0.75 + 0 of 2
    expect(pts(scoreMatch(j, cand({ skills: [], title: 'Forklift operator', summary: 'Hand-held scanner every day' })), 'skills')).toBe(10); // 0.25 + 0.25
  });

  it('weighs experience against what the job asks for', () => {
    expect(yearsWanted('Requires 5+ yrs driving')).toBe(5);
    expect(yearsWanted('At least three years in a hospital')).toBe(3);
    expect(yearsWanted('No experience needed')).toBeNull();
    expect(pts(scoreMatch(job({ description: '4+ years' }), cand({ yearsExp: 2 })), 'experience')).toBe(7.5);
    expect(pts(scoreMatch(job(), cand({ yearsExp: null })), 'experience')).toBe(6);
  });

  it('gaps in certifications, location, pay and availability cost points', () => {
    const m = scoreMatch(job(), cand({ credentials: [], location: 'Dallas, TX', desiredRate: 30, availability: '2 weeks notice' }));
    expect(m.certGaps).toEqual(['Forklift']);
    expect([pts(m, 'certs'), pts(m, 'location'), pts(m, 'pay'), pts(m, 'availability')]).toEqual([0, 6, 0, 3]);
    expect(pts(scoreMatch(job({ remote: true }), cand({ location: 'Miami, FL' })), 'location')).toBe(10);
    expect(pts(scoreMatch(job(), cand({ desiredRate: 22.5 })), 'pay')).toBe(2.5); // within 10%
    expect(['30 days', 'Passive'].map((a) => pts(scoreMatch(job(), cand({ availability: a })), 'availability'))).toEqual([1.5, 1]);
  });

  it('falls back to the job title when the job lists no skills', () => {
    const m = scoreMatch(job({ skills: [] }), cand({ skills: ['Forklift'], title: 'Operator' }));
    expect(pts(m, 'skills')).toBe(40);
    expect(m.factors[0].note).toContain('Add skills to the job');
  });

  it('ranks the stronger candidate higher', () => {
    const strong = scoreMatch(job(), cand()), weak = scoreMatch(job(), cand({ skills: ['Cashier'], title: 'Cashier', sector: 'Retail', yearsExp: 1, credentials: [], location: 'Denver, CO' }));
    expect(strong.score).toBeGreaterThan(weak.score + 50);
    expect(band(weak.score)).toBe('Weak match');
  });
});

const RUN = `mt${Date.now()}`;
let orgId: string, otherOrg: string, rec: string, viewer: string, jobId: string, otherJob: string, ids: Record<string, string> = {};
const as = (u: string) => { session.current = { user: { id: u, orgId } }; };

beforeAll(async () => {
  const o = await db.organization.create({ data: { name: 'Match Co', slug: `mt-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } });
  orgId = o.id;
  otherOrg = (await db.organization.create({ data: { name: 'Other', slug: `mo-${RUN}`, subscriptionStatus: 'active' } })).id;
  const client = await db.client.create({ data: { organizationId: orgId, name: 'Acme DC' } });
  jobId = (await db.job.create({ data: { organizationId: orgId, clientId: client.id, title: 'Forklift Operator', location: 'Austin, TX', skills: ['Forklift', 'RF scanner'], requiredCerts: ['Forklift'], payRate: 21, description: '2+ years.' } })).id;
  await db.job.create({ data: { organizationId: orgId, title: 'Receptionist', location: 'Austin, TX', skills: ['Phones', 'Scheduling'] } });
  otherJob = (await db.job.create({ data: { organizationId: otherOrg, title: 'Theirs', skills: ['Forklift'] } })).id;
  const c = (name: string, d: object, org = orgId) => db.candidate.create({ data: { organizationId: org, name, ...d } }).then((x) => { ids[name] = x.id; return x.id; });
  await c('Ace', { title: 'Forklift Operator', skills: ['Forklift', 'RF Scanner'], yearsExp: 5, location: 'Austin, TX', desiredRate: 20, availability: 'Immediately' });
  await c('Bea', { title: 'Warehouse Associate', skills: ['Forklift'], yearsExp: 1, location: 'Dallas, TX' });
  await c('Cal', { title: 'Cashier', skills: ['Cash handling'], location: 'Denver, CO' });
  await c('Dex', { title: 'Forklift Operator', skills: ['Forklift', 'RF Scanner'], yearsExp: 8, location: 'Austin, TX' }); // barred by the client
  await c('Eve', { title: 'Forklift Operator', skills: ['Forklift', 'RF Scanner'], status: 'Do not use' });
  await c('Fin', { title: 'Forklift Operator', skills: ['Forklift', 'RF Scanner'], yearsExp: 9, location: 'Austin, TX' }, otherOrg);
  await db.credential.createMany({ data: [
    { organizationId: orgId, candidateId: ids.Ace, type: 'Forklift', expiresAt: new Date('2099-01-01') },
    { organizationId: orgId, candidateId: ids.Bea, type: 'Forklift', expiresAt: new Date('2020-01-01') }, // expired
  ] });
  await db.doNotReturn.create({ data: { organizationId: orgId, candidateId: ids.Dex, clientId: client.id, reason: 'No-call no-show' } });
  await db.application.create({ data: { organizationId: orgId, jobId, candidateId: ids.Bea, stage: 'SCREENED', source: 'indeed' } });
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, passwordHash: 'x' } }).then((x) => x.id);
  [rec, viewer] = [await u('rec'), await u('viewer')];
  await db.membership.createMany({ data: [{ userId: rec, organizationId: orgId, role: 'RECRUITER' }, { userId: viewer, organizationId: orgId, role: 'VIEWER' }] });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('ranking from the database', () => {
  it('ranks the pool best first, skipping do-not-return, inactive and other companies’ people', async () => {
    const r = await rankForJob(tenantDb(orgId), jobId, { pool: true });
    expect(r.prospects.map((p) => p.name)).toEqual(['Ace', 'Cal']);
    expect(r.prospects[0].score).toBe(100);
    expect(r.inPipeline.map((p) => [p.name, p.stage, p.source])).toEqual([['Bea', 'SCREENED', 'indeed']]);
    expect(r.inPipeline[0].flags).toEqual(['Missing certification']); // her forklift card expired
  });

  it('ranks open jobs for a candidate, leaving out the ones they’re in', async () => {
    expect((await rankJobsFor(tenantDb(orgId), ids.Ace)).map((j) => j.title)).toEqual(['Forklift Operator', 'Receptionist']);
    expect((await rankJobsFor(tenantDb(orgId), ids.Bea)).map((j) => j.title)).toEqual(['Receptionist']);
  });

  it('scores pipeline cards', async () => {
    const app = await db.application.findFirstOrThrow({ where: { jobId } });
    const m = await scoreApplications(tenantDb(orgId), [{ id: app.id, jobId, candidateId: ids.Bea }]);
    expect(m.get(app.id)).toBe((await rankForJob(tenantDb(orgId), jobId)).inPipeline[0].score);
  });

  it('routes are tenant-scoped and for recruiters', async () => {
    as(rec);
    const ok = await JOB_MATCHES(new Request('http://x'), { params: { id: jobId } });
    expect(ok.status).toBe(200);
    const body = JSON.stringify(await ok.json());
    expect(body).not.toContain('Fin'); expect(body).not.toContain('Dex');
    expect((await JOB_MATCHES(new Request('http://x'), { params: { id: otherJob } })).status).toBe(404);
    expect((await CAND_MATCHES(new Request('http://x'), { params: { id: ids.Fin } })).status).toBe(404);
    expect((await CAND_MATCHES(new Request('http://x'), { params: { id: ids.Ace } })).status).toBe(200);
    as(viewer);
    expect((await JOB_MATCHES(new Request('http://x'), { params: { id: jobId } })).status).toBe(403);
  });
});
