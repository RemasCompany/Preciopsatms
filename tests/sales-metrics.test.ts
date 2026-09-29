import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { POST } from '@/app/api/records/[kind]/route';
import { PATCH } from '@/app/api/records/[kind]/[id]/route';
import { POST as CONVERT } from '@/app/api/records/[kind]/[id]/convert/route';
import { PUT as TARGET } from '@/app/api/sales/targets/route';
import { GET as TEAM } from '@/app/api/team/options/route';
import { importCsv } from '@/lib/import-export';
import { monthsIn, periodRange, salesMetrics, type SalesDeal } from '@/lib/sales-metrics';

const D = (s: string) => new Date(`${s}T12:00:00Z`);
const deal = (o: Partial<SalesDeal>): SalesDeal => ({
  id: Math.random().toString(36).slice(2), title: 'Deal', client: null, value: 0, stage: 'Prospect', ownerId: 'a',
  createdAt: D('2026-01-01'), closedAt: null, stageChangedAt: D('2026-09-25'), closeDate: null, ...o,
});

describe('sales metrics math', () => {
  const now = D('2026-09-29');
  const { from, to } = periodRange('month', now);
  const deals = [
    deal({ stage: 'Won', value: 30000, ownerId: 'a', createdAt: D('2026-08-30'), closedAt: D('2026-09-09') }), // 10-day cycle
    deal({ stage: 'Won', value: 10000, ownerId: 'b', createdAt: D('2026-08-10'), closedAt: D('2026-09-09') }), // 30-day cycle
    deal({ stage: 'Lost', value: 99000, ownerId: 'a', closedAt: D('2026-09-15') }),
    deal({ stage: 'Won', value: 50000, ownerId: 'a', closedAt: D('2026-08-15') }), // last month
    deal({ stage: 'Proposal', value: 40000, ownerId: 'a', title: 'Stale', stageChangedAt: D('2026-09-01') }),
    deal({ stage: 'Qualified', value: 20000, ownerId: null, title: 'Overdue', closeDate: D('2026-09-20') }),
    deal({ stage: 'Prospect', value: 10000, ownerId: 'b', title: 'Fresh', closeDate: D('2026-10-20') }),
  ];
  const leads = [
    { ownerId: 'a', status: 'Converted', createdAt: D('2026-09-02'), convertedAt: D('2026-09-10') },
    { ownerId: 'a', status: 'Qualified', createdAt: D('2026-09-03'), convertedAt: null },
    { ownerId: 'b', status: 'Contacted', createdAt: D('2026-09-04'), convertedAt: null },
    { ownerId: 'b', status: 'New', createdAt: D('2026-09-05'), convertedAt: null },
    { ownerId: 'b', status: 'Converted', createdAt: D('2026-07-01'), convertedAt: D('2026-09-01') },
  ];
  const messages = [{ sentById: 'a', createdAt: D('2026-09-10') }, { sentById: 'a', createdAt: D('2026-09-11') }, { sentById: 'b', createdAt: D('2026-08-11') }];
  const targets = [{ userId: 'a', month: '2026-09', amount: 60000 }, { userId: 'b', month: '2026-09', amount: 20000 }, { userId: 'a', month: '2026-08', amount: 40000 }];
  const reps = [{ id: 'a', label: 'Ana' }, { id: 'b', label: 'Ben' }];
  const m = salesMetrics({ deals, leads, messages, targets, reps, from, to, now });

  it('computes team KPIs for the period', () => {
    expect(m.kpis).toMatchObject({
      wonRevenue: 40000, wonCount: 2, lostCount: 1, winRate: 2 / 3, avgDeal: 20000, avgCycleDays: 20,
      openPipeline: 70000, weighted: 40000 * 0.5 + 20000 * 0.25 + 10000 * 0.1, openCount: 3,
      newLeads: 4, leadConversion: 1 / 4, convertedLeads: 2, outreach: 2, target: 80000, attainment: 0.5,
    });
  });

  it('filters everything to one rep', () => {
    const a = salesMetrics({ deals, leads, messages, targets, reps, from, to, now, rep: 'a' }).kpis;
    expect(a).toMatchObject({ wonRevenue: 30000, wonCount: 1, lostCount: 1, winRate: 0.5, target: 60000, attainment: 0.5, newLeads: 2, outreach: 2 });
  });

  it('ranks reps by revenue won and lists unassigned work separately', () => {
    expect(m.board.map((r) => [r.label, r.wonRevenue, r.attainment])).toEqual([['Ana', 30000, 0.5], ['Ben', 10000, 0.5], ['Unassigned', 0, null]]);
  });

  it('charts six months of won revenue against target', () => {
    expect(m.monthly.map((x) => x.month)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(m.monthly.slice(-2)).toEqual([{ month: '2026-08', won: 50000, target: 40000 }, { month: '2026-09', won: 40000, target: 80000 }]);
  });

  it('builds the lead funnel from the period’s new leads', () => {
    expect(m.funnel.map((f) => f.count)).toEqual([4, 3, 2, 1]);
  });

  it('flags stale and overdue open deals, biggest first', () => {
    expect(m.attention.map((d) => [d.title, d.reason])).toEqual([
      ['Stale', 'No stage change in 28 days'],
      ['Overdue', 'Expected close 2026-09-20 has passed'],
    ]);
  });

  it('has no rates before anything closes', () => {
    const k = salesMetrics({ deals: [], leads: [], messages: [], targets: [], reps, from, to, now }).kpis;
    expect([k.winRate, k.avgDeal, k.avgCycleDays, k.leadConversion, k.attainment]).toEqual([null, null, null, null, null]);
  });

  it('builds whole-month periods', () => {
    expect(periodRange('lastQuarter', now)).toEqual({ from: new Date('2026-04-01T00:00:00Z'), to: new Date('2026-07-01T00:00:00Z') });
    expect(periodRange('lastMonth', D('2026-01-15')).from).toEqual(new Date('2025-12-01T00:00:00Z'));
    expect(monthsIn(...Object.values(periodRange('last12', now)) as [Date, Date])).toHaveLength(12);
  });
});

const RUN = `s${Date.now()}`;
let org: string, other: string, admin: string, rep: string, outsider: string;
const as = (userId: string, orgId = org) => { session.current = { user: { id: userId, orgId } }; };
const json = (method: string, body: object) => new Request('http://x', { method, body: JSON.stringify(body) });

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Acme', slug: `a-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  other = (await db.organization.create({ data: { name: 'Other', slug: `o-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  admin = (await db.user.create({ data: { email: `admin@${RUN}.test`, name: 'Ada Admin', passwordHash: 'x' } })).id;
  rep = (await db.user.create({ data: { email: `rep@${RUN}.test`, name: 'Rex Rep', passwordHash: 'x' } })).id;
  outsider = (await db.user.create({ data: { email: `out@${RUN}.test`, passwordHash: 'x' } })).id;
  await db.membership.createMany({ data: [
    { userId: admin, organizationId: org, role: 'ADMIN' }, { userId: rep, organizationId: org, role: 'RECRUITER' },
    { userId: outsider, organizationId: other, role: 'OWNER' },
  ] });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('deal and lead owners', () => {
  it('defaults the owner to whoever creates the record', async () => {
    as(rep);
    const res = await POST(json('POST', { title: 'Big deal', value: 1000 }), { params: { kind: 'deals' } });
    const { id } = await res.json();
    expect((await db.deal.findUnique({ where: { id } }))!.ownerId).toBe(rep);
  });

  it('accepts a teammate and rejects someone from another company', async () => {
    as(admin);
    const ok = await POST(json('POST', { company: 'Globex', ownerId: rep }), { params: { kind: 'leads' } });
    expect(ok.status).toBe(201);
    const bad = await POST(json('POST', { company: 'Initech', ownerId: outsider }), { params: { kind: 'leads' } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/isn’t on your team/);
    const none = await POST(json('POST', { company: 'Umbrella', ownerId: null }), { params: { kind: 'leads' } });
    const { id } = await none.json();
    expect((await db.lead.findUnique({ where: { id } }))!.ownerId).toBeNull();
  });

  it('still saves a record whose owner has left the team', async () => {
    as(admin);
    const d = await db.deal.create({ data: { organizationId: org, title: 'Legacy', ownerId: outsider } });
    const res = await PATCH(json('PATCH', { title: 'Legacy renewal', ownerId: outsider }), { params: { kind: 'deals', id: d.id } });
    expect(res.status).toBe(200);
    expect(await db.deal.findUnique({ where: { id: d.id } })).toMatchObject({ title: 'Legacy renewal', ownerId: outsider });
    const bad = await PATCH(json('PATCH', { ownerId: outsider }), { params: { kind: 'deals', id: (await db.deal.create({ data: { organizationId: org, title: 'New' } })).id } });
    expect(bad.status).toBe(400);
  });

  it('lists only this company’s people as owner options', async () => {
    as(rep);
    const body = await (await TEAM()).json();
    expect(body.me).toBe(rep);
    expect(body.options.map((o: { label: string }) => o.label)).toEqual(['Ada Admin', 'Rex Rep']);
  });

  it('imports owners by name or email and reports unknown ones', async () => {
    const r = await importCsv(tenantDb(org), 'leads', `Company,Owner\nA Co,rex rep\nB Co,admin@${RUN}.test\nC Co,Nobody\nD Co,`, org, admin);
    expect(r.created).toBe(3);
    expect(r.skipped).toEqual([{ row: 4, error: 'No one on your team named “Nobody”.' }]);
    const rows = await db.lead.findMany({ where: { organizationId: org, company: { in: ['A Co', 'B Co', 'D Co'] } }, orderBy: { company: 'asc' } });
    expect(rows.map((l) => l.ownerId)).toEqual([rep, admin, null]);
  });
});

describe('timestamps for metrics', () => {
  it('records stage changes and close dates, and clears them when a deal reopens', async () => {
    as(rep);
    const d = await db.deal.create({ data: { organizationId: org, title: 'T', stage: 'Proposal', stageChangedAt: new Date('2026-01-01') } });
    await PATCH(json('PATCH', { stage: 'Won' }), { params: { kind: 'deals', id: d.id } });
    let row = (await db.deal.findUnique({ where: { id: d.id } }))!;
    expect(row.closedAt).not.toBeNull();
    expect(row.stageChangedAt.getTime()).toBeGreaterThan(new Date('2026-01-02').getTime());
    await PATCH(json('PATCH', { stage: 'Negotiation' }), { params: { kind: 'deals', id: d.id } });
    row = (await db.deal.findUnique({ where: { id: d.id } }))!;
    expect(row.closedAt).toBeNull();
    // Editing other fields doesn't count as moving the deal.
    const before = row.stageChangedAt.getTime();
    await PATCH(json('PATCH', { notes: 'hi', stage: 'Negotiation' }), { params: { kind: 'deals', id: d.id } });
    expect((await db.deal.findUnique({ where: { id: d.id } }))!.stageChangedAt.getTime()).toBe(before);
  });

  it('stamps a lead’s conversion and gives its owner the new deal', async () => {
    as(admin);
    const lead = await db.lead.create({ data: { organizationId: org, company: 'Hooli', ownerId: rep } });
    const res = await CONVERT(new Request('http://x', { method: 'POST' }), { params: { kind: 'leads', id: lead.id } });
    expect(res.status).toBeLessThan(300);
    expect((await db.lead.findUnique({ where: { id: lead.id } }))!.convertedAt).not.toBeNull();
    const deal = await db.deal.findFirst({ where: { organizationId: org, title: { startsWith: 'Hooli' } } });
    expect(deal!.ownerId).toBe(rep);

    const l2 = await db.lead.create({ data: { organizationId: org, company: 'Pied Piper' } });
    await PATCH(json('PATCH', { status: 'Converted' }), { params: { kind: 'leads', id: l2.id } });
    expect((await db.lead.findUnique({ where: { id: l2.id } }))!.convertedAt).not.toBeNull();
    await PATCH(json('PATCH', { status: 'Qualified' }), { params: { kind: 'leads', id: l2.id } });
    expect((await db.lead.findUnique({ where: { id: l2.id } }))!.convertedAt).toBeNull();
  });
});

describe('sales targets', () => {
  const put = (body: object) => TARGET(json('PUT', body));

  it('lets admins set, change and clear a target', async () => {
    as(admin);
    expect((await put({ userId: rep, month: '2026-09', amount: 50000 })).status).toBe(200);
    expect((await put({ userId: rep, month: '2026-09', amount: 65000 })).status).toBe(200);
    let rows = await db.salesTarget.findMany({ where: { organizationId: org } });
    expect(rows.map((r) => Number(r.amount))).toEqual([65000]);
    await put({ userId: rep, month: '2026-09', amount: null });
    rows = await db.salesTarget.findMany({ where: { organizationId: org } });
    expect(rows).toHaveLength(0);
  });

  it('is admin-only', async () => {
    as(rep);
    expect((await put({ userId: rep, month: '2026-09', amount: 1 })).status).toBe(403);
  });

  it('rejects people from another company and bad input with friendly errors', async () => {
    as(admin);
    const r1 = await put({ userId: outsider, month: '2026-09', amount: 1 });
    expect([r1.status, (await r1.json()).error]).toEqual([400, 'That person isn’t on your team.']);
    const r2 = await put({ userId: rep, month: '2026-13', amount: 1 });
    expect((await r2.json()).error).toBe('Choose a month.');
    const r3 = await put({ userId: rep, month: '2026-09', amount: -5 });
    expect((await r3.json()).error).toBe('Enter a target of $0 or more.');
  });

  it('keeps targets inside their company', async () => {
    as(admin);
    await put({ userId: rep, month: '2026-10', amount: 1000 });
    expect(await tenantDb(other).salesTarget.count()).toBe(0);
    as(outsider, other);
    const r = await put({ userId: rep, month: '2026-10', amount: 9 });
    expect(r.status).toBe(400);
    expect(Number((await db.salesTarget.findFirst({ where: { organizationId: org, userId: rep } }))!.amount)).toBe(1000);
  });
});
