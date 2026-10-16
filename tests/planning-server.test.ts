import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { hoursOnly, loadPlanning } from '@/lib/planning-server';
import { GET as EXPORT } from '@/app/api/planning/export/route';

const RUN = `plan${Date.now()}`;
let org: string, other: string, owner: string, rec: string, viewer: string;
const NOW = new Date('2026-10-16T15:00:00Z');

beforeAll(async () => {
  const mk = (n: string) => db.organization.create({ data: { name: n, slug: `${n.toLowerCase()}-${RUN}`, plan: 'growth', subscriptionStatus: 'active', timezone: 'America/Chicago' } }).then((o) => o.id);
  [org, other] = await Promise.all([mk('Acme'), mk('Other')]);
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, passwordHash: 'x' } }).then((x) => x.id);
  [owner, rec, viewer] = [await u('owner'), await u('rec'), await u('viewer')];
  await db.membership.createMany({ data: [{ userId: owner, organizationId: org, role: 'OWNER' }, { userId: rec, organizationId: org, role: 'RECRUITER' }, { userId: viewer, organizationId: org, role: 'VIEWER' }] });
  for (const [o, clientName, hrs] of [[org, 'Harbor', 40], [org, 'Sunbelt', 20], [other, 'Theirs', 99]] as const) {
    const client = await db.client.create({ data: { organizationId: o, name: clientName } });
    const job = await db.job.create({ data: { organizationId: o, clientId: client.id, title: 'Picker', payRate: 20, billRate: 30, openings: o === org && clientName === 'Harbor' ? 3 : 1, status: 'OPEN' } });
    const c = await db.candidate.create({ data: { organizationId: o, name: `${clientName} worker` } });
    const app = await db.application.create({ data: { organizationId: o, candidateId: c.id, jobId: job.id, stage: 'PLACED' } });
    const rows = [];
    for (let w = new Date('2025-01-05T00:00:00Z'); w <= new Date('2026-10-11T00:00:00Z'); w = new Date(w.getTime() + 7 * 864e5)) {
      const ly = w.getUTCFullYear() === 2025;
      rows.push({ organizationId: o, applicationId: app.id, weekEnding: w, regularHours: ly ? hrs * 0.9 : hrs, overtimeHours: 0, payRate: 20, billRate: 30, status: 'PAID' as const });
    }
    await db.timesheet.createMany({ data: rows });
  }
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('labor planning from the database', () => {
  it('compares this year with last for this company only, by client', async () => {
    const o = await db.organization.findUniqueOrThrow({ where: { id: org } });
    const p = await loadPlanning(tenantDb(org), o, { group: 'client', now: NOW });
    expect(p.lastWeek).toBe('2026-10-11');
    expect(p.ytd.change.hours).toBeCloseTo(11.1, 0); // 60 h/week against 54
    expect(p.monthly[0].thisYear!.hours).toBe(240); // 4 weeks × 60
    expect(p.segments.map((s) => s.name)).toEqual(['Harbor', 'Sunbelt']);
    expect(p.segments[0].hiring.openReqs).toBe(2); // 3 openings, 1 placed
    expect(p.overall!.hiring.openReqs).toBe(2); // all open jobs count for everyone
    expect(p.overall!.capacity.active).toBe(2);
    expect(JSON.stringify(p)).not.toContain('Theirs');
    const h = hoursOnly(p);
    expect([h.ytd.thisYear.costCents, h.monthly[0].thisYear!.costCents, h.ytd.costPerHour.thisYear]).toEqual([0, 0, null]);
  });

  it('exports CSV — labor cost only for owners and admins, nothing for viewers', async () => {
    session.current = { user: { id: owner, orgId: org } };
    const a = await (await EXPORT(new Request('http://x/api/planning/export?group=client'))).text();
    expect(a.split('\n')[2]).toContain('labor cost');
    expect(a).toContain('Harbor');
    session.current = { user: { id: rec, orgId: org } };
    const r = await EXPORT(new Request('http://x/api/planning/export'));
    expect(r.status).toBe(200);
    expect((await r.text()).split('\n')[2]).not.toContain('labor cost');
    session.current = { user: { id: viewer, orgId: org } };
    expect((await EXPORT(new Request('http://x/api/planning/export'))).status).toBe(403);
  });
});
