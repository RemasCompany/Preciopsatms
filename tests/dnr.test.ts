import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ id: 'e' })) }));

import { db } from '@/lib/db';
import { newToken, sha256 } from '@/lib/tokens';
import { GET as LIST, POST as ADD } from '@/app/api/dnr/route';
import { DELETE as LIFT } from '@/app/api/dnr/[id]/route';
import { POST as ADD_TO_JOB } from '@/app/api/applications/route';
import { PATCH as MOVE } from '@/app/api/applications/[id]/route';
import { POST as SHIFT } from '@/app/api/shifts/route';
import { POST as PORTAL } from '@/app/api/portal/[token]/route';

const RUN = `dn${Date.now()}`;
let org: string, admin: string, rec: string, harbor: string, other: string, jobH: string, jobO: string, cand: string, appO: string, contact: string;
const as = (u: string) => { session.current = { user: { id: u, orgId: org } }; };
const req = (method: string, body?: object) => new Request('http://x', { method, headers: { 'x-forwarded-for': '9.9.9.1' }, body: body ? JSON.stringify(body) : undefined });

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'DNR Staffing', slug: `d-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [admin, rec] = await Promise.all([u('admin'), u('rec')]);
  await db.membership.createMany({ data: [{ userId: admin, organizationId: org, role: 'ADMIN' }, { userId: rec, organizationId: org, role: 'RECRUITER' }] });
  harbor = (await db.client.create({ data: { organizationId: org, name: 'Harbor Point' } })).id;
  other = (await db.client.create({ data: { organizationId: org, name: 'Sunbelt Foods' } })).id;
  contact = (await db.contact.create({ data: { organizationId: org, clientId: other, name: 'Sue Sunbelt', email: 'sue@s.test' } })).id;
  jobH = (await db.job.create({ data: { organizationId: org, clientId: harbor, title: 'Forklift', type: 'TEMP', openings: 5 } })).id;
  jobO = (await db.job.create({ data: { organizationId: org, clientId: other, title: 'Line Cook', type: 'TEMP', openings: 5 } })).id;
  cand = (await db.candidate.create({ data: { organizationId: org, name: 'Tom Nguyen' } })).id;
  appO = (await db.application.create({ data: { organizationId: org, candidateId: cand, jobId: jobO, stage: 'PLACED' } })).id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('do not return', () => {
  let entry: string;
  it('blocks a client’s jobs, but not other clients', async () => {
    as(rec);
    expect((await (await ADD(req('POST', { candidateId: cand, clientId: harbor, reason: 'x' }))).json()).error).toBe('Say why — it helps whoever sees this later.');
    const r = await ADD(req('POST', { candidateId: cand, clientId: harbor, reason: 'No-call no-show twice' }));
    expect(r.status).toBe(201);
    entry = (await r.json()).id;
    const blocked = await ADD_TO_JOB(req('POST', { jobId: jobH, candidateId: cand }));
    expect([blocked.status, (await blocked.json()).error]).toEqual([409, 'Tom Nguyen is on Harbor Point’s do-not-return list (No-call no-show twice). An admin can lift it from the candidate’s record.']);
    expect((await SHIFT(req('POST', { applicationId: appO, dates: ['2030-01-07'], start: '07:00', end: '15:00', breakMinutes: 30 }))).status).toBe(201); // other client is fine
    expect(await db.auditLog.count({ where: { organizationId: org, action: 'dnr.add' } })).toBe(1);
  });

  it('only admins lift, with a reason, and the record stays', async () => {
    expect((await LIFT(req('DELETE', { reason: 'Talked with the client' }), { params: { id: entry } })).status).toBe(403);
    as(admin);
    expect((await LIFT(req('DELETE', { reason: 'Talked with the client' }), { params: { id: entry } })).status).toBe(200);
    as(rec);
    expect((await ADD_TO_JOB(req('POST', { jobId: jobH, candidateId: cand }))).status).toBe(201);
    const rows = await (await LIST(new Request(`http://x?candidate=${cand}`))).json();
    expect(rows).toEqual([expect.objectContaining({ client: 'Harbor Point', liftReason: 'Talked with the client' })]);
  });

  it('company-wide entries block placing and scheduling anywhere', async () => {
    await ADD(req('POST', { candidateId: cand, clientId: null, reason: 'Safety violation' }));
    const app = await db.application.findFirst({ where: { candidateId: cand, jobId: jobH } });
    expect((await (await MOVE(req('PATCH', { stage: 'PLACED' }), { params: { id: app!.id } })).json()).error).toMatch(/company-wide do-not-return list \(Safety violation\)/);
    expect((await SHIFT(req('POST', { applicationId: appO, dates: ['2030-01-08'], start: '07:00', end: '15:00', breakMinutes: 30 }))).status).toBe(409);
    await db.doNotReturn.updateMany({ where: { organizationId: org, clientId: null }, data: { liftedAt: new Date() } });
  });

  it('a client saying “wouldn’t have them back” adds them to that client’s list', async () => {
    const token = newToken();
    await db.clientPortalLink.create({ data: { organizationId: org, contactId: contact, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 864e5) } });
    expect((await PORTAL(req('POST', { action: 'rate', applicationId: appO, rating: 1, wouldRehire: false, comment: 'Late every day' }), { params: { token } })).status).toBe(200);
    const d = await db.doNotReturn.findFirst({ where: { organizationId: org, clientId: other, liftedAt: null } });
    expect(d).toMatchObject({ source: 'client feedback', reason: 'Sue Sunbelt said they wouldn’t have them back: “Late every day”' });
    expect((await SHIFT(req('POST', { applicationId: appO, dates: ['2030-01-09'], start: '07:00', end: '15:00', breakMinutes: 30 }))).status).toBe(409);
  });
});
