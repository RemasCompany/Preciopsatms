import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { GET as FIND } from '@/app/api/messages/recipients/route';

const RUN = `nm${Date.now()}`;
let org: string, other: string, rec: string, viewer: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const find = async (q: string) => { const r = await FIND(new Request(`http://x?q=${encodeURIComponent(q)}`)); return { status: r.status, people: r.ok ? (await r.json()).people : null }; };

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Msg Co', slug: `m-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  other = (await db.organization.create({ data: { name: 'Other Co', slug: `o-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  rec = await u('rec'); viewer = await u('viewer');
  await db.membership.createMany({ data: [{ userId: rec, organizationId: org, role: 'RECRUITER' }, { userId: viewer, organizationId: org, role: 'VIEWER' }, { userId: rec, organizationId: other, role: 'RECRUITER' }] });
  const t = tenantDb(org);
  await t.candidate.create({ data: { name: 'Ana Ruiz', email: 'ana@x.test', phone: '+18135550100', smsOptOut: true } as never });
  await t.candidate.create({ data: { name: 'Ana NoContact' } as never });
  const client = await t.client.create({ data: { name: 'Anaheim Foods' } as never });
  await t.contact.create({ data: { clientId: client.id, name: 'Rita Alvarez', email: 'rita@anaheim.test' } as never });
  await t.lead.create({ data: { company: 'Banana Logistics', contact: 'Sam Lee', phone: '+13055550111' } as never });
  await tenantDb(other).candidate.create({ data: { name: 'Ana Elsewhere', email: 'ana2@x.test' } as never });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('new message: finding who to write to', () => {
  it('finds candidates, client contacts and leads by name, company or phone, only with a way to reach them', async () => {
    as(rec);
    const r = await find('ana');
    expect(r.people.map((p: { type: string; name: string }) => `${p.type}:${p.name}`).sort()).toEqual(['candidate:Ana Ruiz', 'contact:Rita Alvarez', 'lead:Sam Lee']);
    expect(r.people.find((p: { name: string }) => p.name === 'Ana Ruiz')).toMatchObject({ email: 'ana@x.test', smsOptOut: true });
    expect((await find('5550100')).people.map((p: { name: string }) => p.name)).toEqual(['Ana Ruiz']);
    expect((await find('a')).people).toEqual([]);
  });
  it('stays inside the company and isn’t open to viewers', async () => {
    as(rec, other);
    expect((await find('ana')).people.map((p: { name: string }) => p.name)).toEqual(['Ana Elsewhere']);
    as(viewer);
    expect((await find('ana')).status).toBe(403);
  });
});
