import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; attachments?: { filename: string; content: Buffer }[] }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: (typeof mail.sent)[number]) => { mail.sent.push(o); return { id: 'e' }; }) }));

import { db } from '@/lib/db';
import { previousPeriod } from '@/lib/reports';
import { runScheduledReports } from '@/lib/reports-server';
import { GET as REPORT } from '@/app/api/reports/[key]/route';
import { POST as SCHEDULE } from '@/app/api/reports/schedules/route';

describe('report periods', () => {
  it('finds last week and last month', () => {
    expect(previousPeriod('weekly', '2026-10-05')).toEqual({ from: '2026-09-28', to: '2026-10-04' }); // a Monday
    expect(previousPeriod('weekly', '2026-10-04')).toEqual({ from: '2026-09-21', to: '2026-09-27' }); // a Sunday
    expect(previousPeriod('monthly', '2026-10-01')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(previousPeriod('monthly', '2026-03-01')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});

const RUN = `rp${Date.now()}`;
let org: string, admin: string, rec: string, north: string;
const as = (u: string) => { session.current = { user: { id: u, orgId: org } }; };
const get = (key: string, q: string) => REPORT(new Request(`http://x?${q}`), { params: { key } });

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Report Co', shortName: 'ReportCo', slug: `r-${RUN}`, plan: 'growth', subscriptionStatus: 'active', timezone: 'America/New_York' } })).id;
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [admin, rec] = await Promise.all([u('admin'), u('rec')]);
  await db.membership.createMany({ data: [{ userId: admin, organizationId: org, role: 'ADMIN' }, { userId: rec, organizationId: org, role: 'RECRUITER' }] });
  north = (await db.branch.create({ data: { organizationId: org, name: 'North' } })).id;
  const c1 = await db.client.create({ data: { organizationId: org, name: 'Harbor' } });
  const c2 = await db.client.create({ data: { organizationId: org, name: 'Sunbelt' } });
  const j1 = await db.job.create({ data: { organizationId: org, clientId: c1.id, title: 'Forklift', type: 'TEMP', payRate: 20, billRate: 30, branchId: north, createdAt: new Date('2026-09-01T12:00:00Z') } });
  const j2 = await db.job.create({ data: { organizationId: org, clientId: c2.id, title: 'Cook', type: 'TEMP', payRate: 15, billRate: 21 } });
  const cand = (n: string, source: string) => db.candidate.create({ data: { organizationId: org, name: n, source } }).then((x) => x.id);
  const a1 = await db.application.create({ data: { organizationId: org, candidateId: await cand('Ana', 'Indeed'), jobId: j1.id, stage: 'PLACED', maxStage: 'PLACED', stageChangedAt: new Date('2026-09-11T15:00:00Z'), createdAt: new Date('2026-09-05T12:00:00Z') } });
  const a2 = await db.application.create({ data: { organizationId: org, candidateId: await cand('Ben', 'Referral'), jobId: j2.id, stage: 'PLACED', maxStage: 'PLACED', stageChangedAt: new Date('2026-09-15T15:00:00Z'), createdAt: new Date('2026-09-06T12:00:00Z') } });
  await db.application.create({ data: { organizationId: org, candidateId: await cand('Cy', 'Indeed'), jobId: j1.id, stage: 'REJECTED', maxStage: 'INTERVIEW', rejectionReason: 'Other', createdAt: new Date('2026-09-07T12:00:00Z') } });
  const ts = (applicationId: string, week: string, reg: number, ot: number, pay: number, bill: number) => db.timesheet.create({ data: { organizationId: org, applicationId, weekEnding: new Date(`${week}T00:00:00Z`), regularHours: reg, overtimeHours: ot, payRate: pay, billRate: bill, status: 'APPROVED' } });
  await ts(a1.id, '2026-09-13', 40, 5, 20, 30); await ts(a1.id, '2026-09-20', 40, 0, 20, 30); await ts(a2.id, '2026-09-20', 30, 0, 15, 21);
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('reports', () => {
  const sept = 'from=2026-09-01&to=2026-09-30';
  it('margin by client, with overtime at 1.5x', async () => {
    as(admin);
    const t = await (await get('margin', sept)).json();
    // Harbor: billed 40×30+5×45+40×30 = 2625, paid 40×20+5×30+40×20 = 1750 → 875 (33.3%). Sunbelt: 630 − 450 = 180.
    expect(t.rows).toEqual([
      { client: 'Harbor', hours: 85, ot: 5, billed: 2625, paid: 1750, margin: 875, marginPct: 33.3 },
      { client: 'Sunbelt', hours: 30, ot: 0, billed: 630, paid: 450, margin: 180, marginPct: 28.6 },
    ]);
    expect(t.total).toMatchObject({ billed: 3255, margin: 1055, marginPct: 32.4 });
    expect((await (await get('margin', `${sept}&branch=${north}`)).json()).rows.map((r: { client: string }) => r.client)).toEqual(['Harbor']);
  });

  it('placements, funnel, sources and time to fill', async () => {
    const p = await (await get('placements', sept)).json();
    expect(p.rows.map((r: { worker: string; spread: number; markup: number }) => [r.worker, r.spread, r.markup])).toEqual([['Ana', 10, 50], ['Ben', 6, 40]]);
    const f = await (await get('funnel', sept)).json();
    expect(f.rows.find((r: { stage: string }) => r.stage === 'Interview')).toMatchObject({ reached: 3, ofAll: 100 });
    expect(f.rows.find((r: { stage: string }) => r.stage === 'Placed')).toMatchObject({ reached: 2, fromPrev: expect.any(Number) });
    const s = await (await get('sources', sept)).json();
    expect(s.rows).toEqual([{ source: 'Indeed', apps: 2, interviewed: 2, placed: 1, rate: 50 }, { source: 'Referral', apps: 1, interviewed: 1, placed: 1, rate: 100 }]);
    const ttf = await (await get('timeToFill', sept)).json();
    expect(ttf.rows.find((r: { job: string }) => r.job === 'Forklift')).toMatchObject({ days: 10 });
    const csv = await (await get('margin', `${sept}&format=csv`)).text();
    expect(csv.split('\r\n')[0]).toBe('Client,Hours,OT hours,Billed,Gross pay,Margin,Margin %');
  });

  it('keeps pay and margin from recruiters', async () => {
    as(rec);
    expect((await get('margin', sept)).status).toBe(403);
    expect((await get('funnel', sept)).status).toBe(200);
    expect((await (await get('funnel', 'from=2026-09-30&to=2026-09-01')).json()).error).toBe('The start date is after the end date.');
  });

  it('emails schedules on the right day, once, only to people allowed to see them', async () => {
    as(admin);
    expect((await (await SCHEDULE(new Request('http://x', { method: 'POST', body: JSON.stringify({ report: 'margin', frequency: 'weekly', userIds: [admin, rec] }) }))).json()).error).toBe('This report has pay and margin figures, so only owners and admins can get it.');
    expect((await SCHEDULE(new Request('http://x', { method: 'POST', body: JSON.stringify({ report: 'margin', frequency: 'monthly', userIds: [admin] }) }))).status).toBe(201);
    mail.sent = [];
    await runScheduledReports(new Date('2026-10-02T14:00:00Z')); // not the 1st
    expect(mail.sent.filter((m) => m.to === `admin@${RUN}.test`)).toHaveLength(0);
    await runScheduledReports(new Date('2026-10-01T14:00:00Z'));
    await runScheduledReports(new Date('2026-10-01T18:00:00Z')); // same day again
    const mine = mail.sent.filter((m) => m.to === `admin@${RUN}.test`);
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toBe('ReportCo: Gross margin by client, 2026-09-01 to 2026-09-30');
    expect(mine[0].attachments![0].content.toString()).toContain('Harbor,85,5,2625,1750,875,33.3');
  });
});
