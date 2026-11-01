import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ id: 'e' })) }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { applicableRules, inRegularRate, majorHolidays, perHour, premiumTotals, timedHours } from '@/lib/differentials';
import { timesheetRows } from '@/lib/timesheets';
import { syncItems, loadRun } from '@/lib/payroll-run-server';
import { exportRun, totals } from '@/lib/payroll-run';
import { invoiceSummary, loadInvoice } from '@/lib/invoicing-server';
import { splitLines } from '@/lib/accounting';
import { POST as ADD_RULE } from '@/app/api/pay-rules/route';
import { PATCH as EDIT_RULE } from '@/app/api/pay-rules/[id]/route';
import { GET as PREMIUMS, POST as ADD } from '@/app/api/timesheets/premiums/route';
import { DELETE as REMOVE } from '@/app/api/timesheets/premiums/[id]/route';
import { POST as FROM_CLOCK } from '@/app/api/timesheets/premiums/calculate/route';
import { PUT as HOURS } from '@/app/api/timesheets/route';
import { POST as APPROVE } from '@/app/api/timesheets/approve/route';
import { POST as INVOICE } from '@/app/api/invoices/route';
import { PATCH as EDIT_INVOICE } from '@/app/api/invoices/[id]/route';

describe('differential math', () => {
  it('works out the extra per hour', () => {
    expect(perHour({ kind: 'NIGHT', mode: 'ADD', pay: 3, bill: 4.5 }, 40, 60)).toEqual({ pay: 3, bill: 4.5 });
    expect(perHour({ kind: 'HOLIDAY', mode: 'MULTIPLY', pay: 1.5, bill: 1.5 }, 40, 60)).toEqual({ pay: 20, bill: 30 });
    expect(perHour({ kind: 'HOLIDAY', mode: 'MULTIPLY', pay: 1.5, bill: 0 }, 40, 60)).toEqual({ pay: 20, bill: 0 });
  });
  it('raises the overtime rate for premiums that count, but not 1.5× holiday pay (FLSA)', () => {
    expect(inRegularRate({ kind: 'NIGHT', mode: 'ADD', pay: 3, bill: 0 })).toBe(true);
    expect(inRegularRate({ kind: 'HOLIDAY', mode: 'MULTIPLY', pay: 1.5, bill: 0 })).toBe(false);
    expect(inRegularRate({ kind: 'HOLIDAY', mode: 'MULTIPLY', pay: 1.25, bill: 0 })).toBe(true);
    // 40 regular + 8 overtime, 12 night hours at +$3: $36 premium; overtime adds ½ × $36/48 × 8 = $3.00.
    expect(premiumTotals([{ hours: 12, payPerHour: 3, billPerHour: 4.5, inRegularRate: true }], 40, 8)).toEqual({ pay: 3600, bill: 5400, overtime: 300, totalPay: 3900 });
    expect(premiumTotals([{ hours: 8, payPerHour: 20, billPerHour: 30, inRegularRate: false }], 40, 8).overtime).toBe(0);
    expect(premiumTotals([{ hours: 12, payPerHour: 3, billPerHour: 0, inRegularRate: true }], 36, 0).overtime).toBe(0);
  });
  it('picks the job’s own rule over the client’s and the company’s', () => {
    const base = { mode: 'ADD', bill: 0, active: true };
    const rules = [{ ...base, id: 'co', kind: 'NIGHT', pay: 3, jobId: null, clientId: null }, { ...base, id: 'cl', kind: 'NIGHT', pay: 4, jobId: null, clientId: 'c1' },
      { ...base, id: 'jb', kind: 'NIGHT', pay: 5, jobId: 'j1', clientId: 'c1' }, { ...base, id: 'wk', kind: 'WEEKEND', pay: 2, jobId: null, clientId: null },
      { ...base, id: 'x', kind: 'WEEKEND', pay: 9, jobId: 'j2', clientId: null }, { ...base, id: 'off', kind: 'CHARGE', pay: 2, jobId: null, clientId: null, active: false }];
    expect(applicableRules(rules, { id: 'j1', clientId: 'c1' }).map((r) => r.id)).toEqual(['jb', 'wk']);
    expect(applicableRules(rules, { id: 'j3', clientId: 'c1' }).map((r) => r.id)).toEqual(['cl', 'wk']);
    expect(applicableRules(rules, { id: 'j3', clientId: null }).map((r) => r.id)).toEqual(['co', 'wk']);
  });
  it('finds night, weekend and holiday hours in punches, in the company’s time zone', () => {
    // 6:00 pm – 6:30 am Eastern, 30-minute break: 11.5 of 12.5 clock hours are 7 pm – 7 am, less their share of the break.
    const p = [{ clockIn: new Date('2026-11-03T23:00:00Z'), clockOut: new Date('2026-11-04T11:30:00Z'), breakMinutes: 30 }];
    expect(timedHours(p, { kind: 'NIGHT', startTime: '19:00', endTime: '07:00' }, 'America/New_York')).toBe(11.04);
    expect(timedHours(p, { kind: 'WEEKEND' }, 'America/New_York')).toBe(0);
    const sat = [{ clockIn: new Date('2026-11-07T20:00:00Z'), clockOut: new Date('2026-11-08T06:00:00Z'), breakMinutes: 0 }];
    expect(timedHours(sat, { kind: 'WEEKEND' }, 'UTC')).toBe(10);
    expect(timedHours(sat, { kind: 'HOLIDAY', holidays: ['2026-11-08'] }, 'UTC')).toBe(6);
  });
  it('knows the six major holidays', () => {
    expect(majorHolidays(2026)).toEqual(['2026-01-01', '2026-05-25', '2026-07-04', '2026-09-07', '2026-11-26', '2026-12-25']);
    expect(majorHolidays(2027)).toEqual(['2027-01-01', '2027-05-31', '2027-07-04', '2027-09-06', '2027-11-25', '2027-12-25']);
  });
});

const RUN = `df${Date.now()}`;
const WEEK = '2026-10-25'; // a Sunday
let org: string, owner: string, rec: string, client: string, job: string, app: string, nightCo: string;
const rules: Record<string, string> = {};
const as = (u: string) => { session.current = { user: { id: u, orgId: org } }; };
const json = (method: string, body?: unknown) => new Request('http://x', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const rule = async (body: object) => { const r = await ADD_RULE(json('POST', body)); return { status: r.status, body: await r.json() }; };
const add = async (ruleId: string, hours: number) => { const r = await ADD(json('POST', { applicationId: app, week: WEEK, ruleId, hours })); return { status: r.status, body: await r.json() }; };
const row = async () => (await timesheetRows(tenantDb(org), new Date(`${WEEK}T00:00:00Z`))).find((r) => r.applicationId === app)!;

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Night Nurses', slug: `n-${RUN}`, plan: 'growth', subscriptionStatus: 'active', timezone: 'UTC' } })).id;
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  owner = await u('owner'); rec = await u('rec');
  await db.membership.createMany({ data: [{ userId: owner, organizationId: org, role: 'OWNER' }, { userId: rec, organizationId: org, role: 'RECRUITER' }] });
  const t = tenantDb(org);
  client = (await t.client.create({ data: { name: 'Bay Hospital' } as never })).id;
  job = (await t.job.create({ data: { title: 'ICU RN', clientId: client, type: 'CONTRACT', payRate: 40, billRate: 60 } as never })).id;
  const c = await t.candidate.create({ data: { name: 'Ana Ruiz' } as never });
  app = (await t.application.create({ data: { candidateId: c.id, jobId: job, stage: 'PLACED' } as never })).id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('differentials on timesheets, payroll and invoices', () => {
  it('only an owner or admin sets them up, and they’re checked', async () => {
    as(rec);
    expect((await rule({ name: 'Night', kind: 'NIGHT', mode: 'ADD', pay: 3, bill: 4.5, startTime: '19:00', endTime: '07:00' })).status).toBe(403);
    as(owner);
    expect((await rule({ name: 'Night', kind: 'NIGHT', mode: 'ADD', pay: 3, bill: 4.5 })).body.error).toMatch(/night hours/);
    expect((await rule({ name: 'Holiday', kind: 'HOLIDAY', mode: 'MULTIPLY', pay: 4, bill: 1.5, holidays: ['2026-11-26'] })).body.error).toMatch(/between 1 and 3/);
    nightCo = (await rule({ name: 'Night shift', kind: 'NIGHT', mode: 'ADD', pay: 3, bill: 4.5, startTime: '19:00', endTime: '07:00' })).body.id;
    rules.night = (await rule({ name: 'ICU nights', kind: 'NIGHT', mode: 'ADD', pay: 5, bill: 7, startTime: '19:00', endTime: '07:00', jobId: job })).body.id;
    rules.weekend = (await rule({ name: 'Weekend', kind: 'WEEKEND', mode: 'ADD', pay: 2, bill: 3 })).body.id;
    rules.holiday = (await rule({ name: 'Holiday', kind: 'HOLIDAY', mode: 'MULTIPLY', pay: 1.5, bill: 1.5, holidays: majorHolidays(2026) })).body.id;
    rules.oncall = (await rule({ name: 'On call', kind: 'ON_CALL', mode: 'FLAT', pay: 4, bill: 6, clientId: client })).body.id;
    expect(await db.auditLog.count({ where: { organizationId: org, action: 'payrule.change' } })).toBe(5);
  });

  it('adds premium hours on a draft timesheet, within the hours worked', async () => {
    as(rec);
    expect((await HOURS(json('PUT', { applicationId: app, week: WEEK, regularHours: 40, overtimeHours: 8 }))).status).toBe(200);
    const list = await (await PREMIUMS(new Request(`http://x?applicationId=${app}&week=${WEEK}`))).json();
    // The job's own night rule replaces the company-wide one.
    expect(list.rules.map((r: { name: string; pay: number }) => [r.name, r.pay])).toEqual(expect.arrayContaining([['ICU nights', 5], ['Weekend', 2], ['Holiday', 20], ['On call', 4]]));
    expect(list.rules.find((r: { id: string }) => r.id === nightCo)).toBeUndefined();
    expect((await add(nightCo, 12)).body.error).toMatch(/different client or job/);
    expect((await add(rules.night, 60)).body.error).toMatch(/more than the 48 hours worked/);
    expect((await add(rules.night, 12)).status).toBe(201);
    expect((await add(rules.oncall, 10)).status).toBe(201); // on call: separate hours on top
    expect((await add(rules.oncall, 200)).body.error).toMatch(/More hours than exist/);
    // Hours can't drop below the premium hours already on the week.
    expect((await HOURS(json('PUT', { applicationId: app, week: WEEK, regularHours: 10, overtimeHours: 0 }))).status).toBe(409);
  });

  it('pays the premiums with the overtime they add, and bills them', async () => {
    const r = await row();
    // $60 night + $40 on call count toward the regular rate: ½ × $100 / 48 hours × 8 OT hours = $8.33 more.
    expect(r.premiumPay).toBe(108.33);
    expect(r.gross).toBeCloseTo(40 * 40 + 8 * 60 + 108.33, 2);
    expect(r.premiumBill).toBe(12 * 7 + 10 * 6);
    expect(r.billable).toBe(40 * 60 + 8 * 90 + 144);
  });

  it('works out night and weekend hours from the time clock, keeping hand-entered lines', async () => {
    const t = tenantDb(org);
    await t.timeEntry.create({ data: { applicationId: app, clockIn: new Date('2026-10-24T19:00:00Z'), clockOut: new Date('2026-10-25T07:00:00Z'), breakMinutes: 0 } as never });
    as(rec);
    expect(await (await FROM_CLOCK(json('POST', { applicationId: app, week: WEEK }))).json()).toEqual({ lines: 2 });
    const lines = await t.timesheetPremium.findMany({ orderBy: { createdAt: 'asc' } });
    expect(lines.map((l) => [l.label, Number(l.hours), l.auto])).toEqual([['ICU nights', 12, false], ['On call', 10, false], ['ICU nights', 12, true], ['Weekend', 12, true]]);
    // Recalculating replaces only the worked-out lines.
    await FROM_CLOCK(json('POST', { applicationId: app, week: WEEK }));
    expect(await t.timesheetPremium.count()).toBe(4);
    for (const l of await t.timesheetPremium.findMany({ where: { auto: true } })) expect((await REMOVE(new Request('http://x', { method: 'DELETE' }), { params: { id: l.id } })).status).toBe(200);
  });

  it('locks premiums once approved; a rule change doesn’t touch weeks already entered', async () => {
    as(owner);
    expect((await EDIT_RULE(json('PATCH', { name: 'ICU nights', kind: 'NIGHT', mode: 'ADD', pay: 9, bill: 12, startTime: '19:00', endTime: '07:00', jobId: job }), { params: { id: rules.night } })).status).toBe(200);
    expect((await row()).premiumPay).toBe(108.33);
    expect((await APPROVE(json('POST', { week: WEEK, action: 'approve' }))).status).toBe(200);
    as(rec);
    expect((await add(rules.weekend, 4)).body.error).toMatch(/already approved/);
  });

  it('puts them in the payroll run and its export', async () => {
    const t = tenantDb(org);
    const run = await t.payrollRun.create({ data: { number: 'PR-1', frequency: 'WEEKLY', periodStart: new Date('2026-10-19T00:00:00Z'), periodEnd: new Date(`${WEEK}T00:00:00Z`), payDate: new Date('2026-10-30T00:00:00Z') } as never });
    await t.$transaction((tx) => syncItems(tx, run));
    const { items, meta } = await loadRun(t, run.id);
    expect(items[0].premiumPay).toBe(108.33);
    expect(items[0].premiums!.map((p) => [p.label, p.amount])).toEqual([['ICU nights', 60], ['On call', 40], ['Overtime on differentials (regular rate)', 8.33]]);
    const tt = totals(items);
    expect(tt.gross).toBe(Math.round((40 * 40 + 8 * 60 + 108.33) * 100));
    expect(tt.billable).toBe((40 * 60 + 8 * 90 + 144) * 100);
    const csv = exportRun('csv', meta, items);
    expect(csv.split('\r\n')[0]).toContain('Differentials and premiums');
    expect(csv.split('\r\n')[1]).toContain('108.33');
    expect(exportRun('paychex', meta, items)).toContain('DIFF');
  });

  it('bills them as their own invoice lines, which survive editing the draft and match the books', async () => {
    as(owner);
    const r = await INVOICE(json('POST', { clientId: client, from: '2026-10-19', to: WEEK }));
    expect(r.status).toBe(201);
    const inv = await loadInvoice(tenantDb(org), (await r.json()).id);
    expect(inv.lines.filter((l) => l.kind === 'premium').map((l) => [l.description, Number(l.quantity), Number(l.amount)])).toEqual([['ICU RN — ICU nights', 12, 84], ['ICU RN — On call', 10, 60]]);
    expect(Number(inv.total)).toBe(40 * 60 + 8 * 90 + 144);
    expect(invoiceSummary(inv).labor).toBe((40 * 60 + 8 * 90 + 144) * 100);
    expect((await EDIT_INVOICE(json('PATCH', { action: 'details', items: [{ kind: 'fee', description: 'Parking', quantity: 1, rate: 10 }] }), { params: { id: inv.id } })).status).toBe(200);
    const again = await loadInvoice(tenantDb(org), inv.id);
    expect(again.lines.filter((l) => l.kind === 'premium')).toHaveLength(2);
    expect(Number(again.total)).toBe(40 * 60 + 8 * 90 + 144 + 10);
    expect(splitLines(again).reduce((s, l) => s + l.cents, 0)).toBe(Math.round(Number(again.total) * 100));
  });
});
