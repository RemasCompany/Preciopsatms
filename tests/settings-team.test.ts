import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const mail = vi.hoisted(() => ({ sent: [] as { to: unknown; text: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: { to: unknown; text: string }) => { mail.sent.push(o); return { id: 'x' }; }) }));
vi.mock('@/lib/stripe', async (orig) => ({ ...(await orig<typeof import('@/lib/stripe')>()), syncSeats: vi.fn(async () => {}) }));

import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { authOptions } from '@/lib/auth';
import { syncSeats } from '@/lib/stripe';
import { PATCH as ORG } from '@/app/api/org/route';
import { POST as IMPORT } from '@/app/api/import/[kind]/route';
import { GET as EXPORT } from '@/app/api/export/[kind]/route';
import { GET as ACCOUNT } from '@/app/api/account/export/route';
import { POST as INVITE } from '@/app/api/team/invite/route';
import { PATCH as ROLE, DELETE as REMOVE } from '@/app/api/team/members/[id]/route';
import { GET as INVITE_INFO, POST as ACCEPT } from '@/app/api/invite/[token]/route';
import { parseCsv } from '@/lib/csv';

const RUN = `s${Date.now()}`;
let org: string, starter: string, owner: string, admin: string, recruiter: string, outsider: string;
const as = (id: string, o = org) => { session.current = { user: { id, orgId: o } }; };
const json = (method: string, body?: unknown) => new Request('http://x', { method, body: body === undefined ? undefined : JSON.stringify(body) });
const tokenFrom = () => mail.sent.at(-1)!.text.match(/\/invite\/([\w-]+)/)![1];
const member = (userId: string, o = org) => db.membership.findUniqueOrThrow({ where: { userId_organizationId: { userId, organizationId: o } } });

beforeAll(async () => {
  process.env.APP_URL = 'http://localhost:3000';
  org = (await db.organization.create({ data: { name: 'Settings Co', slug: `s-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  starter = (await db.organization.create({ data: { name: 'Tiny Co', slug: `t-${RUN}`, plan: 'starter', subscriptionStatus: 'active' } })).id;
  const mk = async (email: string, o: string, role: 'OWNER' | 'ADMIN' | 'RECRUITER', pw = 'x') => {
    const u = await db.user.create({ data: { email, name: email.split('@')[0], passwordHash: pw === 'x' ? 'x' : await bcrypt.hash(pw, 4) } });
    await db.membership.create({ data: { userId: u.id, organizationId: o, role } }); return u.id;
  };
  owner = await mk(`owner@${RUN}.test`, org, 'OWNER');
  admin = await mk(`admin@${RUN}.test`, org, 'ADMIN');
  recruiter = await mk(`rec@${RUN}.test`, org, 'RECRUITER');
  outsider = await mk(`elsewhere@${RUN}.test`, starter, 'OWNER', 'correct horse battery');
  await mk(`two@${RUN}.test`, starter, 'RECRUITER'); await mk(`three@${RUN}.test`, starter, 'RECRUITER');
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('company settings', () => {
  it('admins update the profile and careers page; recruiters cannot', async () => {
    as(recruiter);
    expect((await ORG(json('PATCH', { careersHeadline: 'Hi' }))).status).toBe(403);
    as(admin);
    expect((await ORG(json('PATCH', { shortName: 'SetCo', careersHeadline: 'Work with us', brandColor: '#112233', showPayOnCareers: false, website: '' }))).status).toBe(200);
    expect(await db.organization.findUniqueOrThrow({ where: { id: org } })).toMatchObject({ shortName: 'SetCo', careersHeadline: 'Work with us', brandColor: '#112233', showPayOnCareers: false, website: null });
  });
  it.each([
    [{ slug: 'hijack' }, 'That setting can’t be changed here.'],
    [{ plan: 'enterprise' }, 'That setting can’t be changed here.'],
    [{ logoUrl: 'http://insecure.test/logo.png' }, 'Use a full https:// address.'],
    [{ brandColor: 'red' }, 'Pick a button color.'],
    [{ applyEmail: 'nope' }, 'Enter a valid apply-by-email address.'],
  ])('rejects %j', async (body, msg) => {
    as(admin);
    const res = await ORG(json('PATCH', body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(msg);
  });
});

describe('CSV import and export', () => {
  it('parses quoted CSV', () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\n\n1,"multi\nline"')).toEqual([['a', 'b'], ['x, y', 'he said "hi"'], ['1', 'multi\nline']]);
  });

  it('imports candidates by column name, joining first/last names and reporting bad rows', async () => {
    as(recruiter);
    const vendor = await db.vendor.create({ data: { organizationId: org, name: 'StaffCo' } });
    const csv = 'First name,Last name,Email Address,Skills,Availability,Vendor,Favorite color\nAna,Diaz,ana@x.test,"Forklift; OSHA",immediately,StaffCo,blue\nBen,Ong,not-an-email,,,,\nCy,Poe,cy@x.test,,,Nope Inc,';
    const res = await IMPORT(json('POST', { csv }), { params: { kind: 'candidates' } });
    const r = await res.json();
    expect(r.created).toBe(1);
    expect(r.skipped).toEqual([{ row: 3, error: 'Enter a valid email address.' }, { row: 4, error: 'No vendor named “Nope Inc”.' }]);
    expect(r.columns.find((c: { column: string }) => c.column === 'Favorite color').field).toBeNull();
    expect(await db.candidate.findFirstOrThrow({ where: { organizationId: org, email: 'ana@x.test' } })).toMatchObject({ name: 'Ana Diaz', skills: ['Forklift', 'OSHA'], availability: 'Immediately', vendorId: vendor.id });
  });

  it('requires the title column and caps rows', async () => {
    as(recruiter);
    expect((await (await IMPORT(json('POST', { csv: 'Email\na@x.test' }), { params: { kind: 'leads' } })).json()).error).toBe('Add a “Company” column.');
    expect((await IMPORT(json('POST', { csv: 'x' }), { params: { kind: 'jobs' } })).status).toBe(404);
  });

  it('exports with labels, names for linked records, and formula-safe cells', async () => {
    as(recruiter);
    await db.client.create({ data: { organizationId: org, name: '=HYPERLINK("http://evil")', paymentTerms: 'Net 15' } });
    const csv = await (await EXPORT(json('GET'), { params: { kind: 'clients' } })).text();
    const rows = parseCsv(csv);
    expect(rows[0].slice(0, 4)).toEqual(['ID', 'Company name', 'Industry', 'Status']);
    expect(rows[1][1]).toBe(`'=HYPERLINK("http://evil")`);
    const cands = parseCsv(await (await EXPORT(json('GET'), { params: { kind: 'candidates' } })).text());
    const ana = cands.find((r) => r[1] === 'Ana Diaz')!;
    expect(ana[cands[0].indexOf('Supplied by vendor')]).toBe('StaffCo');
    expect(ana[cands[0].indexOf('Skills')]).toBe('Forklift; OSHA');
  });

  it('full data export is owner-only and leaves out secrets', async () => {
    as(admin);
    expect((await ACCOUNT()).status).toBe(403);
    as(owner);
    const text = await (await ACCOUNT()).text();
    const data = JSON.parse(text);
    expect(data.organization.id).toBe(org);
    expect(data.candidates.map((c: { name: string }) => c.name)).toContain('Ana Diaz');
    expect(text).not.toMatch(/passwordHash|tokenHash|"key"/);
  });
});

describe('team and invites', () => {
  it('invites, blocks duplicates of members, and a new person accepts', async () => {
    as(admin);
    expect((await (await INVITE(json('POST', { email: `rec@${RUN}.test`, role: 'VIEWER' }))).json()).error).toBe('That person is already on your team.');
    expect((await INVITE(json('POST', { email: `New.Person@${RUN}.test`, role: 'RECRUITER' }))).status).toBe(200);
    const token = tokenFrom();
    session.current = null;
    expect(await (await INVITE_INFO(json('GET'), { params: { token } })).json()).toMatchObject({ company: 'Settings Co', email: `new.person@${RUN}.test`, hasAccount: false });
    expect((await (await ACCEPT(json('POST', { name: 'New Person', password: 'short' }), { params: { token } })).json()).error).toMatch(/10 characters/);
    const res = await ACCEPT(json('POST', { name: 'New Person', password: 'a long enough password' }), { params: { token } });
    expect(res.status).toBe(200);
    const { orgId } = await res.json();
    expect(orgId).toBe(org);
    expect(syncSeats).toHaveBeenCalledWith(org);
    expect((await ACCEPT(json('POST', { name: 'X', password: 'a long enough password' }), { params: { token } })).status).toBe(404);
  });

  it('an existing user confirms their password and signs in to the inviting company', async () => {
    as(admin);
    await INVITE(json('POST', { email: `elsewhere@${RUN}.test`, role: 'ADMIN' }));
    const token = tokenFrom();
    session.current = null;
    expect((await INVITE_INFO(json('GET'), { params: { token } })).status).toBe(200);
    expect((await ACCEPT(json('POST', { password: 'wrong' }), { params: { token } })).status).toBe(401);
    expect((await ACCEPT(json('POST', { password: 'correct horse battery' }), { params: { token } })).status).toBe(200);
    expect((await member(outsider)).role).toBe('ADMIN');
    const creds = authOptions.providers[0] as unknown as { options: { authorize: (c: Record<string, string>) => Promise<{ orgId: string } | null> } };
    expect((await creds.options.authorize({ email: `elsewhere@${RUN}.test`, password: 'correct horse battery', orgId: org }))!.orgId).toBe(org);
    expect((await creds.options.authorize({ email: `elsewhere@${RUN}.test`, password: 'correct horse battery' }))!.orgId).toBe(starter);
  });

  it('enforces the Starter seat limit', async () => {
    as(outsider, starter);
    expect((await INVITE(json('POST', { email: `fourth@${RUN}.test`, role: 'VIEWER' }))).status).toBe(402);
  });

  it('protects owners and self when changing roles or removing people', async () => {
    const o = await member(owner), a = await member(admin), r = await member(recruiter);
    as(admin);
    expect((await ROLE(json('PATCH', { role: 'VIEWER' }), { params: { id: o.id } })).status).toBe(403);
    expect((await ROLE(json('PATCH', { role: 'OWNER' }), { params: { id: r.id } })).status).toBe(403);
    expect((await REMOVE(json('DELETE'), { params: { id: a.id } })).status).toBe(409);
    expect((await ROLE(json('PATCH', { role: 'VIEWER' }), { params: { id: r.id } })).status).toBe(200);
    as(owner);
    expect((await (await ROLE(json('PATCH', { role: 'ADMIN' }), { params: { id: o.id } })).json()).error).toMatch(/at least one owner/);
    expect((await REMOVE(json('DELETE'), { params: { id: r.id } })).status).toBe(200);
    expect(await db.membership.count({ where: { userId: recruiter, organizationId: org } })).toBe(0);
    as(outsider, starter);
    expect((await REMOVE(json('DELETE'), { params: { id: a.id } })).status).toBe(404);
  });
});
