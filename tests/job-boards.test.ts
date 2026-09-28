import { createHmac } from 'crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const stored = vi.hoisted(() => [] as { filename: string; contentType: string; body: Buffer }[]);
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ id: 'x' })) }));
vi.mock('@/lib/storage', () => ({
  putFile: vi.fn(async (orgId: string, filename: string, contentType: string, body: Buffer) => {
    stored.push({ filename, contentType, body });
    const { db } = await import('@/lib/db');
    return db.storedFile.create({ data: { organizationId: orgId, key: `${orgId}/${Math.random()}`, filename, contentType, size: body.length } });
  }),
}));

import { db } from '@/lib/db';
import { buildFeed, descriptionHtml, feedWarnings, sourceFor, verifyIndeedSignature, withSource, type FeedJob, type FeedOrg } from '@/lib/job-boards';
import { GET as FEED } from '@/app/api/public/[slug]/feed.xml/route';
import { GET as JOBS } from '@/app/api/public/[slug]/jobs/route';
import { POST as INDEED } from '@/app/api/public/[slug]/indeed-apply/route';
import { POST as APPLY } from '@/app/api/public/[slug]/apply/route';
import { PATCH as ORG } from '@/app/api/org/route';

const APP = 'https://app.preciopsatms.com';
const org: FeedOrg = { company: 'Demo Staffing, LLC', website: 'https://demo.test', email: 'jobs@demo.test', slug: 'demo', indeedApplyApiToken: null };
const job = (over: Partial<FeedJob> = {}): FeedJob => ({
  id: 'job1', title: 'Forklift Operator & Loader', type: 'TEMP', location: 'Orlando, FL', postalCode: '32801', remote: false, sector: 'Warehouse',
  description: 'Load trucks.\nUse RF scanners.\n\nPay weekly <b>bonus</b>.', payRate: 18.5, posted: '2026-09-01', url: `${APP}/careers/demo/job1`, external: false, ...over,
});
const tag = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<${name}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${name}>`, 'g'))].map((m) => m[1]);

describe('job-board feed (Indeed XML format)', () => {
  it('includes every field boards use, with board-tagged apply links', () => {
    const xml = buildFeed(org, [job()], 'ziprecruiter', APP, new Date('2026-09-28T12:00:00Z'));
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<source>')).toBe(true);
    expect(tag(xml, 'publisher')).toEqual(['Demo Staffing, LLC']);
    expect(xml).toContain('<lastBuildDate>Mon, 28 Sep 2026 12:00:00 GMT</lastBuildDate>');
    const fields = Object.fromEntries(['title', 'referencenumber', 'city', 'state', 'country', 'postalcode', 'email', 'salary', 'jobtype', 'sourcename', 'url'].map((t) => [t, tag(xml, t)[0]]));
    expect(fields).toEqual({ title: 'Forklift Operator & Loader', referencenumber: 'job1', city: 'Orlando', state: 'FL', country: 'US', postalcode: '32801', email: 'jobs@demo.test',
      salary: '$18.50 per hour', jobtype: 'temporary', sourcename: 'Demo Staffing, LLC', url: `${APP}/careers/demo/job1?src=ziprecruiter&utm_source=ziprecruiter&utm_medium=job_board` });
    expect(tag(xml, 'description')[0]).toBe('<p>Load trucks.<br>Use RF scanners.</p><p>Pay weekly &lt;b&gt;bonus&lt;/b&gt;.</p>');
  });

  it('marks fully remote jobs the way Indeed asks', () => {
    const xml = buildFeed(org, [job({ remote: true, location: '' })], null, APP);
    expect(tag(xml, 'city')).toEqual(['Remote']);
    expect(tag(xml, 'remotetype')).toEqual(['Fully remote']);
  });

  it('adds Indeed Apply only when connected, only to the Indeed/generic feed, and never to external-apply jobs', () => {
    const connected = { ...org, indeedApplyApiToken: 'tok123' };
    const xml = buildFeed(connected, [job(), job({ id: 'ext', external: true, url: 'https://ats.example/apply/9' })], 'indeed', APP);
    const data = tag(xml, 'indeed-apply-data');
    expect(data).toHaveLength(1);
    const p = new URLSearchParams(data[0]);
    expect(Object.fromEntries(p)).toMatchObject({ 'indeed-apply-apiToken': 'tok123', 'indeed-apply-jobId': 'job1', 'indeed-apply-jobTitle': 'Forklift Operator & Loader',
      'indeed-apply-jobCompanyName': 'Demo Staffing, LLC', 'indeed-apply-jobLocation': 'Orlando FL', 'indeed-apply-postUrl': `${APP}/api/public/demo/indeed-apply` });
    expect(data[0]).toContain('Forklift%20Operator%20%26%20Loader'); // & inside a value is encoded, delimiters are not
    expect(tag(xml, 'url')[1]).toBe('https://ats.example/apply/9'); // external links are left alone
    expect(tag(buildFeed(connected, [job()], 'talent', APP), 'indeed-apply-data')).toEqual([]);
    expect(tag(buildFeed(org, [job()], 'indeed', APP), 'indeed-apply-data')).toEqual([]);
  });

  it('cannot be broken out of CDATA by job text', () => {
    const xml = buildFeed(org, [job({ title: 'Evil ]]><script>x</script>' })], null, APP);
    expect(xml).not.toContain(']]><script>');
    expect(xml).toContain('<title><![CDATA[Evil ]]]]><![CDATA[><script>x</script>]]></title>'); // standard CDATA split
  });

  it('warns about jobs boards would hide', () => {
    const w = feedWarnings([
      { id: 'a', title: 'No state', location: 'Orlando', remote: false, description: 'x'.repeat(200) },
      { id: 'b', title: 'Remote ok', location: '', remote: true, description: 'x'.repeat(200) },
      { id: 'c', title: 'Short', location: 'Tampa, FL', remote: false, description: 'Hiring now.' },
    ]);
    expect(w.map((x) => [x.id, x.problem.split(' ')[0]])).toEqual([['a', 'Add'], ['c', 'Write']]);
  });

  it('maps apply-link sources and tags links', () => {
    expect([sourceFor('indeed'), sourceFor('talent'), sourceFor('google'), sourceFor(undefined), sourceFor('spam')]).toEqual(['Indeed', 'Talent.com', 'Google for Jobs', 'Careers page', 'Careers page']);
    expect(withSource(`${APP}/careers/demo/job1`, null)).toBe(`${APP}/careers/demo/job1`);
    expect(descriptionHtml('')).toBe('<p></p>');
  });

  it('verifies X-Indeed-Signature (Base64 HMAC-SHA1 of the raw body)', () => {
    const body = '{"id":"a"}';
    const sig = createHmac('sha1', 's3cret').update(body).digest('base64');
    expect(verifyIndeedSignature(body, sig, 's3cret')).toBe(true);
    expect(verifyIndeedSignature(body + ' ', sig, 's3cret')).toBe(false);
    expect(verifyIndeedSignature(body, sig, 'other')).toBe(false);
    expect(verifyIndeedSignature(body, null, 's3cret')).toBe(false);
  });
});

const RUN = `j${Date.now()}`;
const SECRET = 'indeed-shared-secret';
let orgId: string, jobId: string, otherJob: string, adminId: string;
const signed = (payload: object, secret = SECRET) => {
  const raw = JSON.stringify(payload);
  return new Request('http://x', { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', 'X-Indeed-Signature': createHmac('sha1', secret).update(raw).digest('base64') } });
};
const application = (over: Record<string, unknown> = {}) => ({
  id: 'ia_1', job: { jobId, jobTitle: 'Picker', jobKey: 'k' },
  applicant: { fullName: 'Ivy Indeed', email: 'Ivy@Example.test', phoneNumber: '555-0100', coverletter: 'Ready to start.',
    resume: { file: { fileName: 'ivy.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-1.4 ivy').toString('base64') } } }, ...over,
});

beforeAll(async () => {
  const o = await db.organization.create({ data: { name: 'Board Co', slug: `b-${RUN}`, plan: 'growth', subscriptionStatus: 'active', applyEmail: 'jobs@b.test', indeedApplyApiToken: 'tok', indeedApplySecret: SECRET } });
  orgId = o.id;
  jobId = (await db.job.create({ data: { organizationId: orgId, title: 'Picker', location: 'Austin, TX', postalCode: '78701', type: 'TEMP', payRate: 17, description: 'Pick and pack orders.' } })).id;
  const other = await db.organization.create({ data: { name: 'Other', slug: `o-${RUN}`, subscriptionStatus: 'active' } });
  otherJob = (await db.job.create({ data: { organizationId: other.id, title: 'Theirs' } })).id;
  const u = await db.user.create({ data: { email: `a@${RUN}.test`, passwordHash: 'x' } });
  await db.membership.create({ data: { userId: u.id, organizationId: orgId, role: 'ADMIN' } });
  adminId = u.id;
  process.env.APP_URL = APP;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('Indeed Apply webhook', () => {
  const p = { params: { slug: `b-${RUN}` } };
  it('rejects a bad or missing signature', async () => {
    expect((await INDEED(signed(application(), 'wrong'), p)).status).toBe(401);
    expect((await INDEED(new Request('http://x', { method: 'POST', body: JSON.stringify(application()) }), p)).status).toBe(401);
  });

  it('creates the candidate with resume and adds them to the job at Applied', async () => {
    const res = await INDEED(signed(application()), p);
    expect(res.status).toBe(200);
    const c = await db.candidate.findFirstOrThrow({ where: { organizationId: orgId, email: 'ivy@example.test' } });
    expect(c).toMatchObject({ name: 'Ivy Indeed', phone: '555-0100', source: 'Indeed', summary: 'Ready to start.' });
    expect(stored.at(-1)).toMatchObject({ filename: 'ivy.pdf', contentType: 'application/pdf' });
    expect(stored.at(-1)!.body.toString()).toBe('%PDF-1.4 ivy');
    expect(await db.application.findFirstOrThrow({ where: { candidateId: c.id, jobId } })).toMatchObject({ stage: 'APPLIED' });
  });

  it('accepts a repeat delivery without duplicating', async () => {
    expect(await (await INDEED(signed(application()), p)).json()).toEqual({ ok: true, duplicate: true });
    expect(await db.application.count({ where: { organizationId: orgId, jobId } })).toBe(1);
  });

  it('refuses another company’s job and bad payloads', async () => {
    expect((await INDEED(signed(application({ job: { jobId: otherJob } })), p)).status).toBe(404);
    expect((await INDEED(signed({ id: 'x', job: { jobId }, applicant: { fullName: 'No Email' } }), p)).status).toBe(400);
    expect((await INDEED(signed(application()), { params: { slug: `o-${RUN}` } })).status).toBe(404); // not connected
  });
});

describe('feed route, jobs API and source attribution', () => {
  const p = { params: { slug: `b-${RUN}` } };
  it('serves the per-board feed with Indeed Apply when connected', async () => {
    const res = await FEED(new Request('http://x/feed.xml?board=indeed'), p);
    expect(res.headers.get('content-type')).toBe('application/xml; charset=utf-8');
    const xml = await res.text();
    expect(tag(xml, 'postalcode')).toEqual(['78701']);
    expect(tag(xml, 'url')[0]).toContain('src=indeed');
    expect(tag(xml, 'indeed-apply-data')[0]).toContain(`indeed-apply-postUrl=${encodeURIComponent(`${APP}/api/public/b-${RUN}/indeed-apply`)}`);
  });

  it('keeps the Indeed token out of the widget JSON', async () => {
    expect(await (await JOBS(new Request('http://x'), p)).json()).not.toHaveProperty('indeedApplyApiToken');
  });

  it('tags careers-page applicants with the board from ?src=', async () => {
    const f = new FormData(); f.set('jobId', jobId); f.set('name', 'Zed Zip'); f.set('email', 'zed@x.test'); f.set('src', 'ziprecruiter');
    expect((await APPLY(new Request('http://x', { method: 'POST', body: f, headers: { 'x-forwarded-for': '10.9.9.9' } }), p)).status).toBe(200);
    expect((await db.candidate.findFirstOrThrow({ where: { organizationId: orgId, email: 'zed@x.test' } })).source).toBe('ZipRecruiter');
  });

  it('admins connect and disconnect Indeed Apply', async () => {
    session.current = { user: { id: adminId, orgId } };
    expect((await ORG(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ indeedApplyApiToken: 'bad token!' }) }))).status).toBe(400);
    expect((await ORG(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ indeedApplyApiToken: null, indeedApplySecret: null }) }))).status).toBe(200);
    expect(await db.organization.findUniqueOrThrow({ where: { id: orgId } })).toMatchObject({ indeedApplyApiToken: null, indeedApplySecret: null });
    expect((await INDEED(signed(application()), p)).status).toBe(404);
  });
});
