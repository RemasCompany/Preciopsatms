import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ id: 'x' })) }));

import { db } from '@/lib/db';
import { BOARD_INFO, BOARD_GROUPS, postsTo } from '@/lib/boards';
import { boardStats, buildFeed, type FeedJob, type FeedOrg } from '@/lib/job-boards';
import { tenantDb } from '@/lib/tenant';
import { GET as FEED } from '@/app/api/public/[slug]/feed.xml/route';
import { POST as APPLY } from '@/app/api/public/[slug]/apply/route';
import { PATCH as BOARDS } from '@/app/api/job-boards/route';
import { PUT as JOB_BOARDS } from '@/app/api/jobs/[id]/boards/route';

const APP = 'https://app.test';
const job = (o: Partial<FeedJob> = {}): FeedJob => ({ id: 'j1', title: 'Forklift Operator', type: 'FULL_TIME', location: 'Austin, TX', postalCode: '78701', remote: false, sector: 'Warehouse',
  description: 'Load trailers and run cycle counts on day shift.', payRate: 21, posted: '2026-10-01', url: `${APP}/careers/demo/j1`, external: false, ...o });
const org: FeedOrg = { company: 'Demo Co', website: null, email: 'jobs@demo.test', slug: 'demo', indeedApplyApiToken: null, jobBoards: ['indeed', 'dice', 'linkedin'], linkedinCompanyId: '12345' };
const tag = (xml: string, t: string) => [...xml.matchAll(new RegExp(`<${t}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${t}>`, 'g'))].map((m) => m[1]);

describe('board catalog and feeds', () => {
  it('lists 18 boards in four groups, each with setup steps', () => {
    const all = Object.values(BOARD_INFO);
    expect(all).toHaveLength(18);
    expect(new Set(all.map((b) => b.group))).toEqual(new Set(BOARD_GROUPS));
    expect(all.every((b) => b.how.length > 20 && b.best.length > 10)).toBe(true);
  });

  it('a board that’s off gets an empty feed; jobs can be limited to some boards', () => {
    const jobs = [job(), job({ id: 'j2', title: 'Java Developer', boards: ['dice'] }), job({ id: 'j3', title: 'Nurse', boards: ['indeed'] })];
    expect(tag(buildFeed(org, jobs, 'ziprecruiter', APP), 'title')).toEqual([]);
    expect(tag(buildFeed(org, jobs, 'indeed', APP), 'title')).toEqual(['Forklift Operator', 'Nurse']);
    expect(tag(buildFeed(org, jobs, 'dice', APP), 'title')).toEqual(['Forklift Operator', 'Java Developer']);
    expect(tag(buildFeed(org, jobs, null, APP), 'title')).toHaveLength(3); // the generic feed has everything
    expect(postsTo(['indeed'], [], 'indeed')).toBe(true);
    expect(postsTo(['indeed'], ['dice'], 'indeed')).toBe(false);
  });

  it('builds LinkedIn’s format for LinkedIn', () => {
    const xml = buildFeed(org, [job(), job({ id: 'r1', title: 'Remote Recruiter', remote: true, type: 'CONTRACT', payRate: 0 })], 'linkedin', APP, new Date('2026-10-16T00:00:00Z'));
    expect(xml).toContain('<expectedJobCount>2</expectedJobCount>');
    expect(tag(xml, 'partnerJobId')).toEqual(['j1', 'r1']);
    expect(tag(xml, 'companyId')).toEqual(['12345', '12345']);
    expect(tag(xml, 'jobtype')).toEqual(['FULL_TIME', 'CONTRACT']);
    expect(tag(xml, 'workplaceTypes')).toEqual(['On-site', 'Remote']);
    expect(tag(xml, 'location')).toEqual(['Austin, TX, US', 'United States']);
    expect(tag(xml, 'applyUrl')[0]).toContain('src=linkedin');
    expect(xml).toContain('<salaries><salary><highEnd><amount>21.00</amount><currencyCode>USD</currencyCode></highEnd>');
    expect(xml.match(/<salaries>/g)).toHaveLength(1); // no pay, no salary block
    expect(xml).not.toContain('<referencenumber>');
  });
});

const RUN = `jb${Date.now()}`;
let orgId: string, jobId: string, otherJob: string, admin: string, rec: string;
const as = (u: string) => { session.current = { user: { id: u, orgId } }; };
const patch = (body: object) => BOARDS(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }));
const put = (id: string, boards: string[]) => JOB_BOARDS(new Request('http://x', { method: 'PUT', body: JSON.stringify({ boards }) }), { params: { id } });
const feed = async (board: string) => (await FEED(new Request(`http://x/feed.xml?board=${board}`), { params: { slug: `jb-${RUN}` } })).text();

beforeAll(async () => {
  process.env.APP_URL = APP;
  const o = await db.organization.create({ data: { name: 'Board Co', slug: `jb-${RUN}`, plan: 'growth', subscriptionStatus: 'active', jobBoards: ['indeed'] } });
  orgId = o.id;
  jobId = (await db.job.create({ data: { organizationId: orgId, title: 'Picker', location: 'Austin, TX', type: 'TEMP', description: 'Pick and pack orders for an e-commerce warehouse. Day shift.' } })).id;
  const other = await db.organization.create({ data: { name: 'Other', slug: `jo-${RUN}`, subscriptionStatus: 'active', jobBoards: ['indeed', 'dice'] } });
  otherJob = (await db.job.create({ data: { organizationId: other.id, title: 'Theirs' } })).id;
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, passwordHash: 'x' } }).then((x) => x.id);
  [admin, rec] = [await u('admin'), await u('rec')];
  await db.membership.createMany({ data: [{ userId: admin, organizationId: orgId, role: 'ADMIN' }, { userId: rec, organizationId: orgId, role: 'RECRUITER' }] });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('turning boards on and picking them per job', () => {
  it('admins turn boards on and off; feeds follow', async () => {
    as(rec);
    expect((await patch({ board: 'dice', on: true })).status).toBe(403);
    as(admin);
    expect((await patch({ board: 'myspace', on: true })).status).toBe(400);
    expect(tag(await feed('dice'), 'title')).toEqual([]);
    expect((await patch({ board: 'dice', on: true })).status).toBe(200);
    expect(tag(await feed('dice'), 'title')).toEqual(['Picker']);
    expect((await patch({ board: 'linkedin', on: true })).status).toBe(200);
    const bad = await patch({ linkedinCompanyId: 'acme' });
    expect([bad.status, (await bad.json()).error]).toEqual([400, 'The LinkedIn company ID is the number in your company page’s admin address.']);
    expect((await patch({ linkedinCompanyId: '98765' })).status).toBe(200);
    expect(tag(await feed('linkedin'), 'companyId')).toEqual(['98765']);
    expect((await db.organization.findUniqueOrThrow({ where: { id: orgId } })).jobBoards).toEqual(['indeed', 'dice', 'linkedin']);
  });

  it('a job can go to only some boards, which must be on', async () => {
    as(rec);
    const off = await put(jobId, ['snagajob']);
    expect([off.status, (await off.json()).error]).toEqual([409, 'Snagajob isn’t turned on. Turn it on in Settings & data first.']);
    expect((await put(jobId, ['dice'])).status).toBe(200);
    expect(tag(await feed('dice'), 'title')).toEqual(['Picker']);
    expect(tag(await feed('indeed'), 'title')).toEqual([]);
    expect((await put(jobId, [])).status).toBe(200);
    expect(tag(await feed('indeed'), 'title')).toEqual(['Picker']);
    expect((await put(otherJob, [])).status).toBe(404);
    as(admin);
    await patch({ board: 'dice', on: false });
    expect(tag(await feed('dice'), 'title')).toEqual([]);
  });

  it('records which board each application came from, and counts them', async () => {
    const p = { params: { slug: `jb-${RUN}` } };
    for (const [n, src, ip] of [['Ana', 'indeed', '10.1.1.1'], ['Ben', 'indeed', '10.1.1.2'], ['Cy', 'linkedin', '10.1.1.3'], ['Dee', '', '10.1.1.4']]) {
      const f = new FormData(); f.set('jobId', jobId); f.set('name', `${n} Test`); f.set('email', `${n.toLowerCase()}@x.test`); if (src) f.set('src', src);
      expect((await APPLY(new Request('http://x', { method: 'POST', body: f, headers: { 'x-forwarded-for': ip } }), p)).status).toBe(200);
    }
    await db.application.updateMany({ where: { jobId, candidate: { name: 'Ben Test' } }, data: { stage: 'PLACED' } });
    expect(await boardStats(tenantDb(orgId))).toEqual({ indeed: { applicants: 2, hired: 1 }, linkedin: { applicants: 1, hired: 0 }, careers: { applicants: 1, hired: 0 } });
  });
});
