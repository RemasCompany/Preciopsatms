import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ id: 'x' })) }));
vi.mock('@/lib/storage', () => {
  const files = new Map<string, Buffer>();
  return {
    putFile: vi.fn(async (organizationId: string, filename: string, contentType: string, buf: Buffer) => {
      const key = `${organizationId}/${Math.random()}`; files.set(key, buf);
      return (await import('@/lib/db')).db.storedFile.create({ data: { organizationId, filename, contentType, key, size: buf.length } as never });
    }),
    getFile: vi.fn(async (key: string) => files.get(key)!),
  };
});

import { db } from '@/lib/db';
import { mergeList, readResume, workMonths } from '@/lib/skills';
import { POST as APPLY } from '@/app/api/public/[slug]/apply/route';
import { POST as SCAN } from '@/app/api/public/[slug]/resume-scan/route';
import { PATCH as REREAD, POST as ATTACH } from '@/app/api/candidates/[id]/resume/route';

const NOW = new Date('2026-10-16T00:00:00Z');
const RESUME = `Jordan Rivers
Dallas, TX 75201 · (214) 555-0100 · jordan@example.com

Summary
Reliable warehouse associate. Safe on sit-down forklifts and stand-up forklifts, RF gun, pallet jacks.

Work Experience
Forklift Operator — Harbor Freight DC
Mar 2021 – Present
Loaded trucks, cycle counts, shipping & receiving, WMS (Manhattan).

Warehouse Associate | Acme Logistics
Jun 2018 - Feb 2021
Pick & pack, inventory, material handling.

Education
Lincoln High School, 2010 - 2014

Certifications
OSHA 10, Forklift certified, CPR/AED`;

describe('reading a resume', () => {
  const r = readResume(RESUME, { vocab: ['Reach truck', 'Order picking'], titles: ['Forklift Operator — 2nd shift'], now: NOW });

  it('finds skills, including other ways of writing them', () => {
    expect(r.skills).toEqual(expect.arrayContaining(['Forklift', 'Sit-down forklift', 'Stand-up forklift', 'Pallet jack', 'RF scanner', 'Pick and pack', 'Shipping and receiving', 'Loading and unloading', 'Inventory', 'Cycle counting', 'Material handling', 'WMS']));
    expect(r.skills).not.toContain('Reach truck');
    expect(r.certs).toEqual(expect.arrayContaining(['OSHA 10', 'Forklift certification', 'CPR']));
  });

  it('counts years from work dates only, merging overlaps and skipping school', () => {
    expect(r.yearsExp).toBe(8); // Jun 2018 – Oct 2026; the 2010–2014 school years don't count
    expect(workMonths('Jan 2020 - Dec 2020\n2020 - 2021\nMay 2019 to Jun 2019', NOW)).toBe(24 + 2);
    expect(readResume('Experience\nCashier, Big Mart\nStore work.\n12 years of retail experience in busy stores and shops.', { now: NOW }).yearsExp).toBe(12);
  });

  it('finds the most recent title and a city and state, never a street address', () => {
    expect(r.title).toBe('Forklift Operator');
    expect(r.location).toBe('Dallas, TX');
    expect(readResume('Sam Lee\n123 Main St, Springfield, IL\nExperience\nCook\nGrill and food prep at Diner 2019 - 2022', { now: NOW }).location).toBe('Springfield, IL');
  });

  it('doesn’t match short codes or common words by accident', () => {
    const x = readResume('Experience\nCrew member\nI learned to be patient, earned a rental license and posed for a word cloud. Worked in the ICU? no.\n2019 - 2020', { now: NOW });
    expect(x.skills).not.toContain('RN'); expect(x.skills).not.toContain('POS'); expect(x.skills).not.toContain('Word');
    expect(x.certs).not.toContain('RN');
    expect(readResume('Licenses\nRN, BLS', { now: NOW }).certs).toEqual(['RN', 'BLS']);
  });

  it('merges lists without duplicates', () => {
    expect(mergeList(['Forklift', 'Excel'], ['forklift', 'RF scanner'])).toEqual(['Forklift', 'Excel', 'RF scanner']);
  });
});

const RUN = `rs${Date.now()}`;
let orgId: string, jobId: string, rec: string, otherCand: string;
const slug = `rs-${RUN}`;
const file = (text: string, name = 'resume.txt') => new File([text], name, { type: 'text/plain' });
const apply = (fields: Record<string, string>, resume?: File, ip = '10.9.0.1') => {
  const f = new FormData(); f.set('jobId', jobId); for (const [k, v] of Object.entries(fields)) f.set(k, v); if (resume) f.set('resume', resume);
  return APPLY(new Request('http://x', { method: 'POST', body: f, headers: { 'x-forwarded-for': ip } }), { params: { slug } });
};

beforeAll(async () => {
  const o = await db.organization.create({ data: { name: 'Resume Co', slug, plan: 'growth', subscriptionStatus: 'active' } });
  orgId = o.id;
  jobId = (await db.job.create({ data: { organizationId: orgId, title: 'Forklift Operator', skills: ['Reach truck', 'RF scanner'], publish: true } })).id;
  const other = await db.organization.create({ data: { name: 'Other', slug: `ro-${RUN}`, subscriptionStatus: 'active' } });
  otherCand = (await db.candidate.create({ data: { organizationId: other.id, name: 'Theirs' } })).id;
  rec = (await db.user.create({ data: { email: `rec@${RUN}.test`, passwordHash: 'x' } })).id;
  await db.membership.create({ data: { userId: rec, organizationId: orgId, role: 'RECRUITER' } });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('applicants’ resumes fill in their profile', () => {
  it('the apply form can read a resume first, without storing it', async () => {
    const f = new FormData(); f.set('resume', file(RESUME + '\nReach trucks')); f.set('jobId', jobId);
    const before = await db.storedFile.count({ where: { organizationId: orgId } });
    const res = await SCAN(new Request('http://x', { method: 'POST', body: f, headers: { 'x-forwarded-for': '10.9.1.1' } }), { params: { slug } });
    const { facts } = await res.json();
    expect(facts.skills).toEqual(expect.arrayContaining(['Reach truck', 'RF scanner', 'Forklift'])); // the company's own job skills are found too
    expect(facts.title).toBe('Forklift Operator');
    expect(await db.storedFile.count({ where: { organizationId: orgId } })).toBe(before);
    const bad = new FormData(); bad.set('resume', file('x', 'photo.png'));
    const r2 = await SCAN(new Request('http://x', { method: 'POST', body: bad, headers: { 'x-forwarded-for': '10.9.1.1' } }), { params: { slug } });
    expect([r2.status, (await r2.json()).error]).toEqual([415, 'Upload a PDF, Word (.docx) or text file. You can still apply — we’ll keep your resume.']);
  });

  it('applying uses what the applicant checked', async () => {
    const profile = JSON.stringify({ skills: ['Forklift', 'Reach truck'], certs: [], yearsExp: 6, title: 'Lead Forklift Operator', location: 'Dallas, TX' });
    expect((await apply({ name: 'Jordan Rivers', email: 'jordan@x.test', profile }, file(RESUME))).status).toBe(200);
    const c = await db.candidate.findFirstOrThrow({ where: { organizationId: orgId, email: 'jordan@x.test' } });
    expect([c.skills, c.yearsExp, c.title, c.location]).toEqual([['Forklift', 'Reach truck'], 6, 'Lead Forklift Operator', 'Dallas, TX']);
  });

  it('without a checked list (the embed widget) the resume is read on the server', async () => {
    expect((await apply({ name: 'Wid Get', email: 'widget@x.test' }, file(RESUME), '10.9.0.2')).status).toBe(200);
    const c = await db.candidate.findFirstOrThrow({ where: { organizationId: orgId, email: 'widget@x.test' } });
    expect(c.skills).toEqual(expect.arrayContaining(['Forklift', 'RF scanner']));
    expect([c.yearsExp, c.location]).toEqual([8, 'Dallas, TX']);
  });

  it('a returning applicant’s skills are added to, and what a recruiter typed is kept', async () => {
    await db.candidate.updateMany({ where: { organizationId: orgId, email: 'jordan@x.test' }, data: { title: 'Typed by recruiter' } });
    const profile = JSON.stringify({ skills: ['forklift', 'Excel'], certs: ['OSHA 10'], yearsExp: 9, title: 'Something else', location: null });
    await apply({ name: 'Jordan Rivers', email: 'jordan@x.test', profile }, file(RESUME), '10.9.0.3');
    const c = await db.candidate.findFirstOrThrow({ where: { organizationId: orgId, email: 'jordan@x.test' } });
    expect([c.skills, c.certs, c.title, c.yearsExp]).toEqual([['Forklift', 'Reach truck', 'Excel'], ['OSHA 10'], 'Typed by recruiter', 6]);
  });

  it('a bad checked list is ignored, not trusted', async () => {
    const profile = JSON.stringify({ skills: Array(100).fill('x'), certs: [], yearsExp: 300, title: null, location: null });
    expect((await apply({ name: 'Bad List', email: 'bad@x.test', profile }, file(RESUME), '10.9.0.4')).status).toBe(200);
    const c = await db.candidate.findFirstOrThrow({ where: { organizationId: orgId, email: 'bad@x.test' } });
    expect(c.skills.length).toBeLessThan(30); expect(c.yearsExp).toBe(8); // read from the resume instead
  });
});

describe('recruiters attaching resumes', () => {
  it('attaching fills in skills; re-reading adds nothing twice; other companies’ candidates are off limits', async () => {
    session.current = { user: { id: rec, orgId } };
    const cand = await db.candidate.create({ data: { organizationId: orgId, name: 'Pat Doe', skills: ['Excel'] } });
    const f = new FormData(); f.set('file', file(RESUME));
    const res = await ATTACH(new Request('http://x', { method: 'POST', body: f }), { params: { id: cand.id } });
    const j = await res.json();
    expect(j.note).toMatch(/^Added \d+ skills, 3 certifications, title, years of experience and location from the resume\.$/);
    const c = await db.candidate.findUniqueOrThrow({ where: { id: cand.id } });
    expect(c.skills[0]).toBe('Excel'); expect(c.skills).toContain('Forklift');
    const again = await (await REREAD(new Request('http://x', { method: 'PATCH' }), { params: { id: cand.id } })).json();
    expect(again.note).toBe('The resume didn’t add anything new to the profile.');
    expect((await REREAD(new Request('http://x', { method: 'PATCH' }), { params: { id: otherCand } })).status).toBe(404);
  });
});
