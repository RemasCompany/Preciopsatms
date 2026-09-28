import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { db } from '@/lib/db';
import { GET as LIST, POST } from '@/app/api/records/[kind]/route';
import { GET, PATCH, DELETE } from '@/app/api/records/[kind]/[id]/route';
import { POST as CONVERT } from '@/app/api/records/[kind]/[id]/convert/route';
import { vendorCompliance } from '@/lib/records';

const RUN = `r${Date.now()}`;
let org: string, other: string, otherClient: string, starterUser: string, ownerUser: string;

const req = (method: string, body?: object) => new Request('http://x', { method, body: body ? JSON.stringify(body) : undefined });
const create = (kind: string, body: object) => POST(req('POST', body), { params: { kind } });
const read = (kind: string, id: string) => GET(req('GET'), { params: { kind, id } });
const update = (kind: string, id: string, body: object) => PATCH(req('PATCH', body), { params: { kind, id } });
const remove = (kind: string, id: string) => DELETE(req('DELETE'), { params: { kind, id } });
const as = (userId: string, orgId: string) => { session.current = { user: { id: userId, orgId } }; };

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'A', slug: `a-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  other = (await db.organization.create({ data: { name: 'B', slug: `b-${RUN}`, plan: 'starter', subscriptionStatus: 'active' } })).id;
  otherClient = (await db.client.create({ data: { organizationId: other, name: 'Theirs' } })).id;
  const u = await db.user.create({ data: { email: `o@${RUN}.test`, passwordHash: 'x' } }); ownerUser = u.id;
  await db.membership.create({ data: { userId: u.id, organizationId: org, role: 'RECRUITER' } });
  const s = await db.user.create({ data: { email: `s@${RUN}.test`, passwordHash: 'x' } }); starterUser = s.id;
  await db.membership.create({ data: { userId: s.id, organizationId: other, role: 'OWNER' } });
  as(ownerUser, org);
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('records API', () => {
  it('creates a job with converted types and ignores organizationId from the client', async () => {
    const res = await create('jobs', { title: 'Welder', type: 'TEMP', status: 'OPEN', openings: '3', payRate: '22.5', billRate: 33, startDate: '2026-10-05', skills: 'MIG, TIG', hot: true, publish: true, organizationId: other });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const row = await db.job.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ organizationId: org, openings: 3, skills: ['MIG', 'TIG'], hot: true, type: 'TEMP' });
    expect(Number(row.payRate)).toBe(22.5);
    const got = await (await read('jobs', id)).json();
    expect(got.record).toMatchObject({ title: 'Welder', payRate: 22.5, billRate: 33, startDate: '2026-10-05' });
    expect(got.extras.applications).toEqual([]);
  });

  it.each([
    [{ title: '' }, 'Job title is required.'],
    [{ title: 'X', type: 'FREELANCE' }, 'Choose a valid employment type.'],
    [{ title: 'X', openings: 1.5 }, 'Openings must be a whole number.'],
    [{ title: 'X', payRate: -1 }, 'Pay rate ($/hr) must be between 0 and ∞.'],
    [{ title: 'X', startDate: '10/05/2026' }, 'Target start must be a valid date.'],
    [{ title: 'X', applyUrl: 'example.com' }, 'Apply link must start with http:// or https://'],
  ])('rejects %j with a friendly message', async (body, msg) => {
    const res = await create('jobs', body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(msg);
  });

  it('rejects an invalid email', async () => {
    const res = await create('candidates', { name: 'Pat', email: 'nope' });
    expect((await res.json()).error).toBe('Enter a valid email address.');
  });

  it('saves a record whose optional selects are empty, and keeps required ones', async () => {
    const c = await db.candidate.create({ data: { organizationId: org, name: 'No Source' } });
    const got = await (await read('candidates', c.id)).json();
    expect(got.record.source).toBeNull();
    const res = await update('candidates', c.id, { ...got.record, desiredRate: 19, status: null });
    expect(res.status).toBe(200);
    expect(await db.candidate.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ source: null, status: 'Active' });
    expect((await update('candidates', c.id, { source: 'Telepathy' })).status).toBe(400);
  });

  it('refuses to link a record from another org', async () => {
    const res = await create('jobs', { title: 'Sneaky', clientId: otherClient });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('That client was not found.');
  });

  it('updates only the fields sent, and cannot touch another org’s record', async () => {
    const { id } = await (await create('clients', { name: 'Acme', city: 'Tampa' })).json();
    expect((await update('clients', id, { city: 'Miami', markupPct: '35' })).status).toBe(200);
    const row = await db.client.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ name: 'Acme', city: 'Miami' });
    expect(Number(row.markupPct)).toBe(35);
    expect((await update('clients', otherClient, { name: 'hacked' })).status).toBe(404);
    expect((await read('clients', otherClient)).status).toBe(404);
    expect((await remove('clients', otherClient)).status).toBe(404);
    expect((await db.client.findUniqueOrThrow({ where: { id: otherClient } })).name).toBe('Theirs');
  });

  it('adds contacts only to the caller’s clients', async () => {
    const { id: clientId } = await (await create('clients', { name: 'Beta' })).json();
    expect((await create('contacts', { name: 'Dana', clientId })).status).toBe(201);
    expect((await create('contacts', { name: 'Eve', clientId: otherClient })).status).toBe(400);
    const got = await (await read('clients', clientId)).json();
    expect(got.extras.contacts.map((c: { name: string }) => c.name)).toEqual(['Dana']);
  });

  it('lists options for linked-record selects', async () => {
    const opts = await (await LIST(req('GET'), { params: { kind: 'clients' } })).json();
    expect(opts.map((o: { label: string }) => o.label)).toEqual(expect.arrayContaining(['Acme', 'Beta']));
    expect(opts.map((o: { label: string }) => o.label)).not.toContain('Theirs');
  });

  it('will not delete a candidate with approved timesheets, and removes EEO data on delete', async () => {
    const job = await db.job.create({ data: { organizationId: org, title: 'Loader', payRate: 18, billRate: 27 } });
    const c1 = await db.candidate.create({ data: { organizationId: org, name: 'Locked' } });
    const app = await db.application.create({ data: { organizationId: org, jobId: job.id, candidateId: c1.id, stage: 'PLACED', maxStage: 'PLACED' } });
    await db.timesheet.create({ data: { organizationId: org, applicationId: app.id, weekEnding: new Date('2026-09-27'), regularHours: 40, overtimeHours: 0, payRate: 18, billRate: 27, status: 'APPROVED' } });
    const blocked = await remove('candidates', c1.id);
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toMatch(/approved timesheets/);

    const c2 = await db.candidate.create({ data: { organizationId: org, name: 'Free' } });
    await db.eeoSelfId.create({ data: { organizationId: org, candidateId: c2.id, gender: 'Female' } });
    expect((await remove('candidates', c2.id)).status).toBe(200);
    expect(await db.eeoSelfId.count({ where: { candidateId: c2.id } })).toBe(0);
  });

  it('converts a lead into a prospect client, contact and qualified deal', async () => {
    const { id } = await (await create('leads', { company: 'Gamma Logistics', contact: 'Lee', role: 'Ops', email: 'lee@gamma.test', industry: 'Logistics', city: 'Austin' })).json();
    const res = await CONVERT(req('POST'), { params: { kind: 'leads', id } });
    expect(res.status).toBe(200);
    const { clientId, dealId } = await res.json();
    expect(await db.client.findUniqueOrThrow({ where: { id: clientId } })).toMatchObject({ name: 'Gamma Logistics', status: 'Prospect', industry: 'Logistics', city: 'Austin' });
    expect(await db.contact.findFirstOrThrow({ where: { clientId } })).toMatchObject({ name: 'Lee', title: 'Ops', email: 'lee@gamma.test' });
    expect(await db.deal.findUniqueOrThrow({ where: { id: dealId } })).toMatchObject({ title: 'Gamma Logistics — staffing', stage: 'Qualified' });
    expect((await db.lead.findUniqueOrThrow({ where: { id } })).status).toBe('Converted');
    expect((await CONVERT(req('POST'), { params: { kind: 'leads', id } })).status).toBe(409);
  });

  it('gates by plan: starter has no vendors', async () => {
    as(starterUser, other);
    expect((await create('vendors', { name: 'V' })).status).toBe(402);
    expect((await create('clients', { name: 'Ok' })).status).toBe(201);
    as(ownerUser, org);
  });

  it('404s an unknown record kind', async () => {
    expect((await create('invoices', {})).status).toBe(404);
  });
});

describe('vendor compliance', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  it('flags missing, expired and soon-expiring paperwork', () => {
    expect(vendorCompliance({}, now).map((i) => i.text)).toEqual(['Insurance date missing', 'Agreement date missing', 'W-9 missing']);
    expect(vendorCompliance({ coiExpiresAt: '2026-09-01', agreementExpiresAt: '2026-10-10', w9ReceivedAt: '2026-01-01' }, now))
      .toEqual([{ level: 'warn', text: 'Insurance expired Sep 1, 2026' }, { level: 'soon', text: 'Agreement expires in 12d' }]);
    expect(vendorCompliance({ coiExpiresAt: '2027-01-01', agreementExpiresAt: '2027-01-01', w9ReceivedAt: '2026-01-01' }, now)).toEqual([]);
  });
});
