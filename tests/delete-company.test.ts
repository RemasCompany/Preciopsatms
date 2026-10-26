import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const stripeCalls = vi.hoisted(() => ({ canceled: [] as string[], fail: false }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/stripe', async (orig) => {
  const real = await orig<typeof import('@/lib/stripe')>();
  return { ...real, stripeEnabled: () => true, stripe: { subscriptions: { cancel: vi.fn(async (id: string) => { if (stripeCalls.fail) throw Object.assign(new Error('down'), { code: 'api_error' }); stripeCalls.canceled.push(id); return {}; }) } } };
});

import { existsSync } from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { putFile } from '@/lib/storage';
import { billingQuantity } from '@/lib/stripe';
import { TENANT_MODELS } from '@/lib/tenant';
import { POST as DELETE_ORG } from '@/app/api/org/delete/route';

const RUN = `del${Date.now()}`;
const PW = 'right-password-1';
let org: string, keep: string, owner: string, admin: string, shared: string, otherOwner: string, fileKey: string;
const as = (id: string, o = org) => { session.current = { user: { id, orgId: o } }; };
const del = async (body: object) => { const r = await DELETE_ORG(new Request('http://x', { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
const email = (who: string) => `${who}@${RUN}.test`;

beforeAll(async () => {
  process.env.STORAGE_DRIVER = 'local';
  const mkOrg = (n: string, sub?: string) => db.organization.create({ data: { name: `${n} Staffing`, slug: `${n}-${RUN}`, plan: 'growth', subscriptionStatus: 'active', stripeSubscriptionId: sub } }).then((o) => o.id);
  org = await mkOrg('Doomed', `sub_${RUN}`); keep = await mkOrg('Keeper');
  const hash = await bcrypt.hash(PW, 4);
  const mk = async (who: string, o: string, role: 'OWNER' | 'ADMIN' | 'RECRUITER') => { const u = await db.user.create({ data: { email: email(who), passwordHash: hash } }); await db.membership.create({ data: { userId: u.id, organizationId: o, role } }); return u.id; };
  owner = await mk('owner', org, 'OWNER'); admin = await mk('admin', org, 'ADMIN'); shared = await mk('shared', org, 'RECRUITER');
  otherOwner = await mk('keeper', keep, 'OWNER');
  await db.membership.create({ data: { userId: shared, organizationId: keep, role: 'RECRUITER' } }); // also works for the other company
  // A spread of the company's records, including an invoice (whose client can't normally be deleted on its own).
  const client = await db.client.create({ data: { organizationId: org, name: 'Harbor' } });
  const job = await db.job.create({ data: { organizationId: org, clientId: client.id, title: 'Packer', payRate: 18, billRate: 26 } });
  const cand = await db.candidate.create({ data: { organizationId: org, name: 'Ana Ruiz', email: 'ana@x.test' } });
  const app = await db.application.create({ data: { organizationId: org, candidateId: cand.id, jobId: job.id, stage: 'PLACED' } });
  await db.timesheet.create({ data: { organizationId: org, applicationId: app.id, weekEnding: new Date('2026-10-11T00:00:00Z'), regularHours: 40, payRate: 18, billRate: 26, status: 'APPROVED' } });
  await db.invoice.create({ data: { organizationId: org, clientId: client.id, number: 'INV-1', issueDate: new Date(), dueDate: new Date(), periodStart: new Date(), periodEnd: new Date(), terms: 'Net 30', total: 1040 } as never });
  await db.activity.create({ data: { organizationId: org, text: 'something happened' } });
  await db.auditLog.create({ data: { organizationId: org, action: 'auth.login', summary: 'x' } });
  fileKey = (await putFile(org, 'resume.pdf', 'application/pdf', Buffer.from('%PDF-1.4 test'))).key;
  await db.candidate.create({ data: { organizationId: keep, name: 'Untouched' } });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('Growth minimum', () => {
  it('bills at least two users on Growth, and the real count above that', async () => {
    const solo = await db.organization.create({ data: { name: 'Solo', slug: `solo-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } });
    expect(await billingQuantity(solo)).toBe(2); // nobody yet
    expect(await billingQuantity({ ...solo, plan: 'starter' })).toBe(1); // flat price
    expect(await billingQuantity({ id: org, plan: 'growth', kind: 'STAFFING' })).toBe(3);
  });
});

describe('deleting a company', () => {
  it('is for the owner only, who confirms with the name, password and two-step code', async () => {
    as(admin);
    expect((await del({ confirmName: 'Doomed Staffing', password: PW })).status).toBe(403);
    as(owner);
    expect((await del({ confirmName: 'Wrong Name', password: PW })).body.error).toMatch(/Type the company name exactly/);
    expect((await del({ confirmName: 'doomed  staffing', password: 'nope' })).body.error).toBe('That password isn’t right.');
    await db.user.update({ where: { id: owner }, data: { totpEnabledAt: new Date(), totpSecret: 'v1.x.y.z' } });
    expect((await del({ confirmName: 'Doomed Staffing', password: PW })).body.error).toMatch(/code from your authenticator app/);
    await db.user.update({ where: { id: owner }, data: { totpEnabledAt: null, totpSecret: null } });
    expect(await db.organization.count({ where: { id: org } })).toBe(1);
  });

  it('deletes nothing if Stripe can’t cancel the subscription', async () => {
    stripeCalls.fail = true;
    as(owner);
    expect((await del({ confirmName: 'Doomed Staffing', password: PW })).body.error).toMatch(/couldn’t cancel your subscription/);
    expect(await db.organization.count({ where: { id: org } })).toBe(1);
    stripeCalls.fail = false;
  });

  it('cancels billing, removes files and every record, and logins nobody else uses', async () => {
    as(owner);
    const r = await del({ confirmName: 'Doomed Staffing', password: PW });
    expect(r).toEqual({ status: 200, body: { ok: true, files: 1, logins: 2 } });
    expect(stripeCalls.canceled).toEqual([`sub_${RUN}`]);
    expect(await db.organization.count({ where: { id: org } })).toBe(0);
    // Nothing left in any company table.
    for (const m of TENANT_MODELS) {
      const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${m}" WHERE "organizationId" = $1`, org);
      expect([m, Number(rows[0].n)]).toEqual([m, 0]);
    }
    expect(existsSync(path.join(process.cwd(), '.data', 'uploads', fileKey))).toBe(false);
    // The owner and admin only worked here; the shared teammate keeps their login for the other company.
    expect(await db.user.count({ where: { id: { in: [owner, admin] } } })).toBe(0);
    expect(await db.membership.findMany({ where: { userId: shared }, select: { organizationId: true } })).toEqual([{ organizationId: keep }]);
    // The other company is untouched.
    expect(await db.candidate.count({ where: { organizationId: keep } })).toBe(1);
    expect(await db.user.count({ where: { id: otherOwner } })).toBe(1);
  });
});
