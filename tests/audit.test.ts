import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ id: 'e' })) }));

import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { authOptions } from '@/lib/auth';
import { audit, auditWhere, describeChanges, diff } from '@/lib/audit';
import { PATCH as ORG } from '@/app/api/org/route';
import { PATCH as ROLE } from '@/app/api/team/members/[id]/route';
import { POST as INVITE } from '@/app/api/team/invite/route';
import { GET as EXPORT } from '@/app/api/audit/export/route';
import { GET as EEO } from '@/app/api/eeo/report/route';

const RUN = `au${Date.now()}`;
let org: string, other: string, owner: string, admin: string, rec: string, recMember: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const req = (method: string, body?: object) => new Request('http://x', { method, headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'TestBrowser/1' }, body: body ? JSON.stringify(body) : undefined });
const log = (o = org) => db.auditLog.findMany({ where: { organizationId: o }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  const mk = (n: string) => db.organization.create({ data: { name: `${n} Staffing`, slug: `${n}-${RUN}`, plan: 'enterprise', subscriptionStatus: 'active' } }).then((o) => o.id);
  [org, other] = await Promise.all([mk('main'), mk('other')]);
  const pw = await bcrypt.hash('right-password', 4);
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: pw } }).then((x) => x.id);
  [owner, admin, rec] = await Promise.all([u('owner'), u('admin'), u('rec')]);
  await db.membership.createMany({ data: [{ userId: owner, organizationId: org, role: 'OWNER' }, { userId: admin, organizationId: org, role: 'ADMIN' }, { userId: rec, organizationId: org, role: 'RECRUITER' }] });
  recMember = (await db.membership.findFirst({ where: { userId: rec, organizationId: org } }))!.id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('helpers', () => {
  it('diffs settings and hides secrets', () => {
    expect(diff({ name: 'A', brandColor: '#000000', indeedApplySecret: 'old' }, { name: 'A', brandColor: '#111111', indeedApplySecret: 'new' }))
      .toEqual({ brandColor: ['#000000', '#111111'], indeedApplySecret: ['(hidden)', '(changed)'] });
    expect(describeChanges({ role: ['RECRUITER', 'ADMIN'], website: [null, 'https://x.test'] })).toBe('role: RECRUITER → ADMIN; website: (empty) → https://x.test');
  });
  it('builds filters and ignores junk', () => {
    expect(auditWhere({ group: 'Team' })).toMatchObject({ action: { in: ['team.invite', 'team.invite_revoke', 'team.join', 'team.role_change', 'team.remove'] } });
    expect(auditWhere({ group: 'Nope', from: 'yesterday' })).toEqual({});
  });
});

describe('recording', () => {
  it('logs settings changes with before/after, IP and browser', async () => {
    as(admin);
    expect((await ORG(req('PATCH', { brandColor: '#123456', indeedApplySecret: 'shh-very-secret' }))).status).toBe(200);
    const [e] = await log();
    expect(e).toMatchObject({ action: 'settings.company', actorEmail: `admin@${RUN}.test`, ip: '203.0.113.9', userAgent: 'TestBrowser/1' });
    expect(JSON.stringify(e.changes)).not.toContain('shh-very-secret');
    expect((e.changes as Record<string, string[]>).brandColor[1]).toBe('#123456');
  });

  it('logs role changes and invites, but not refused attempts', async () => {
    as(rec);
    expect((await ROLE(req('PATCH', { role: 'ADMIN' }), { params: { id: recMember } })).status).toBe(403);
    as(admin);
    expect((await ROLE(req('PATCH', { role: 'ADMIN' }), { params: { id: recMember } })).status).toBe(200);
    expect((await INVITE(req('POST', { email: `new@${RUN}.test`, role: 'VIEWER' }))).status).toBe(200);
    const acts = (await log()).map((e) => [e.action, e.summary]);
    expect(acts).toContainEqual(['team.role_change', `Changed rec@${RUN}.test from recruiter to admin`]);
    expect(acts).toContainEqual(['team.invite', `Invited new@${RUN}.test as viewer`]);
    expect(acts.filter(([a]) => a === 'team.role_change')).toHaveLength(1);
  });

  it('logs EEO report views', async () => {
    as(owner);
    await EEO(req('GET'));
    expect((await log()).at(-1)).toMatchObject({ action: 'eeo.report_view', actorEmail: `owner@${RUN}.test` });
  });

  it('logs sign-ins and wrong passwords for real accounts', async () => {
    const authorize = (authOptions.providers[0] as unknown as { options: { authorize: (c: object, r: object) => Promise<unknown> } }).options.authorize;
    expect(await authorize({ email: `owner@${RUN}.test`, password: 'wrong' }, { headers: { 'x-forwarded-for': '198.51.100.7' } })).toBeNull();
    expect(await authorize({ email: `owner@${RUN}.test`, password: 'right-password' }, { headers: {} })).toMatchObject({ orgId: org });
    const tail = (await log()).slice(-2);
    expect(tail.map((e) => e.action)).toEqual(['auth.login_failed', 'auth.login']);
    expect(tail[0].ip).toBe('198.51.100.7');
  });
});

describe('protection', () => {
  it('is append-only and stays in its company', async () => {
    const tdb = tenantDb(org);
    await expect(tdb.auditLog.deleteMany({})).rejects.toThrow('append-only');
    await expect(tdb.auditLog.updateMany({ data: { summary: 'x' } })).rejects.toThrow('append-only');
    await audit(other, null, 'data.export', 'Other company export');
    expect((await tdb.auditLog.findMany()).some((e) => e.summary === 'Other company export')).toBe(false);
  });

  it('exports CSV for admins only, and records the export', async () => {
    as(rec, org);
    await db.membership.updateMany({ where: { id: recMember }, data: { role: 'RECRUITER' } });
    expect((await EXPORT(req('GET'))).status).toBe(403);
    as(owner);
    const csv = await (await EXPORT(new Request('http://x?group=Team'))).text();
    expect(csv.split('\r\n')[0]).toBe('When (UTC),Who,Action,What happened,Changes,Target type,Target ID,IP address,Browser');
    expect(csv).toContain('Changed a role');
    expect(csv).not.toContain('Signed in');
    expect((await log()).at(-1)).toMatchObject({ action: 'data.audit_export' });
  });
});
