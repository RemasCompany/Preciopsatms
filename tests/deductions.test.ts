import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { deductionCents, activeOn } from '@/lib/deductions';
import { exportRun, totals, type RunItem } from '@/lib/payroll-run';
import { payrollItems } from '@/lib/check-payroll';
import { syncDeductions } from '@/lib/payroll-provider';
import { GET as LIST, POST as ADD } from '@/app/api/payroll/deductions/route';
import { PATCH as END } from '@/app/api/payroll/deductions/[id]/route';
import { POST as CREATE_RUN } from '@/app/api/payroll/runs/route';
import { GET as RUN, PATCH as ACT } from '@/app/api/payroll/runs/[id]/route';
import { POST as ADJ } from '@/app/api/payroll/runs/[id]/adjustments/route';
import { DELETE as UNADJ } from '@/app/api/payroll/adjustments/[id]/route';
import { GET as EXPORT } from '@/app/api/payroll/runs/[id]/export/route';
import { PATCH as SETTINGS } from '@/app/api/payroll/settings/route';

const RUN_ID = `ded${Date.now()}`;
let org: string, other: string, admin: string, rec: string, oUser: string, maria: string, james: string, mariaApp: string, jamesApp: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const req = (method: string, body?: object, url = 'http://x') => new Request(url, { method, body: body ? JSON.stringify(body) : undefined });
const p = (id: string) => ({ params: { id } });
const add = async (b: object) => (await ADD(req('POST', { amountType: 'FIXED', startDate: '2026-01-01', ...b }))).json();

describe('deduction amounts', () => {
  const d = { amountType: 'FIXED' as const, amount: 45, annualLimit: null, startDate: '2026-01-01', endDate: null };
  it('takes a fixed amount or a percent of gross, within the annual limit and the pay available', () => {
    expect(deductionCents(d, 80000, 0, 80000)).toEqual({ cents: 4500, note: null });
    expect(deductionCents({ ...d, amountType: 'PERCENT', amount: 5 }, 81234, 0, 81234)).toEqual({ cents: 4062, note: null });
    expect(deductionCents({ ...d, annualLimit: 100 }, 80000, 8000, 80000)).toEqual({ cents: 2000, note: 'Reached this year’s limit.' });
    expect(deductionCents({ ...d, annualLimit: 100 }, 80000, 10000, 80000)).toEqual({ cents: 0, note: 'This year’s limit was already reached.' });
    expect(deductionCents(d, 3000, 0, 3000)).toEqual({ cents: 3000, note: 'Not enough pay this run to take all of it.' });
    expect(activeOn({ startDate: '2026-01-01', endDate: '2026-06-30' }, '2026-07-03')).toBe(false);
  });

  it('pre-tax deductions lower taxable wages; Check skips recurring ones (it applies its own)', () => {
    const item: RunItem = { id: 'i', candidateId: 'c', workerName: 'Maria Lopez', payrollId: null, position: 'RN', clientId: null, clientName: null, weekEnding: '2026-10-11', regularHours: 40, overtimeHours: 0, payRate: 20, billRate: 30, regularPay: 800, overtimePay: 0,
      adjustments: [{ id: 'a', kind: 'PRETAX_DEDUCTION', description: '401(k)', amount: 40, deductionId: 'd1', code: '401K' }, { id: 'b', kind: 'DEDUCTION', description: 'Uniform', amount: 10, deductionId: 'd2', code: 'UNI' }] };
    expect(totals([item])).toMatchObject({ gross: 80000, pretax: 4000, taxableWages: 76000, deductions: 1000 });
    expect(payrollItems([item], new Map([['c', 'emp_1']]), 'wrk').problems).toEqual([]);
  });
});

beforeAll(async () => {
  const mk = (n: string) => db.organization.create({ data: { name: n, slug: `${n}-${RUN_ID}`, plan: 'enterprise', subscriptionStatus: 'active' } }).then((o) => o.id);
  [org, other] = await Promise.all([mk('acme'), mk('other')]);
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN_ID}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [admin, rec, oUser] = await Promise.all([u('admin'), u('rec'), u('other')]);
  await db.membership.createMany({ data: [{ userId: admin, organizationId: org, role: 'ADMIN' }, { userId: rec, organizationId: org, role: 'RECRUITER' }, { userId: oUser, organizationId: other, role: 'OWNER' }] });
  const job = await db.job.create({ data: { organizationId: org, title: 'Packer', payRate: 20, billRate: 30 } });
  maria = (await db.candidate.create({ data: { organizationId: org, name: 'Maria Lopez', payrollId: 'E1' } })).id;
  james = (await db.candidate.create({ data: { organizationId: org, name: 'James Carter', payrollId: 'E2' } })).id;
  mariaApp = (await db.application.create({ data: { organizationId: org, candidateId: maria, jobId: job.id, stage: 'PLACED' } })).id;
  jamesApp = (await db.application.create({ data: { organizationId: org, candidateId: james, jobId: job.id, stage: 'PLACED' } })).id;
  for (const [app, week] of [[mariaApp, '2026-10-04'], [mariaApp, '2026-10-11'], [jamesApp, '2026-10-11']]) {
    await db.timesheet.create({ data: { organizationId: org, applicationId: app, weekEnding: new Date(`${week}T00:00:00Z`), regularHours: 40, payRate: 20, billRate: 30, status: 'APPROVED' } });
  }
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN_ID } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN_ID}.test` } } });
  await db.$disconnect();
});

describe('recurring deductions in payroll runs', () => {
  let runId: string, k401: string;
  it('are set up by admins, validated, one of a kind per worker', async () => {
    as(rec);
    expect((await ADD(req('POST', { candidateId: maria, type: 'MEDICAL', amountType: 'FIXED', amount: 45, startDate: '2026-01-01' }))).status).toBe(403);
    as(admin);
    expect((await add({ candidateId: maria, type: 'RETIREMENT_401K', amountType: 'PERCENT', amount: 150 })).error).toBe('A percent can’t be more than 100.');
    expect((await add({ candidateId: maria, type: 'MEDICAL', amount: 45, endDate: '2025-12-01' })).error).toBe('It can’t end before it starts.');
    expect((await add({ candidateId: maria, type: 'MEDICAL', amount: 45 })).ok).toBe(true);
    expect((await add({ candidateId: maria, type: 'MEDICAL', amount: 50 })).error).toBe('Maria Lopez already has a health insurance deduction. End it first, then add the new amount.');
    k401 = (await add({ candidateId: maria, type: 'RETIREMENT_401K', amountType: 'PERCENT', amount: 5, annualLimit: 1000 })).id;
    await add({ candidateId: maria, type: 'OTHER', label: 'Uniform rental', amount: 12 });
    await add({ candidateId: james, type: 'DENTAL', amount: 8, startDate: '2026-11-01' }); // not yet
    expect((await (await LIST()).json()).deductions.map((d: { worker: string; label: string; pretax: boolean; code: string }) => `${d.worker}:${d.label}:${d.pretax}:${d.code}`)).toEqual([
      'James Carter:Dental insurance:true:DEN', 'Maria Lopez:Health insurance:true:MED', 'Maria Lopez:401(k):true:401K', 'Maria Lopez:Uniform rental:false:DED',
    ]);
    as(oUser, other);
    expect((await ADD(req('POST', { candidateId: maria, type: 'MEDICAL', amountType: 'FIXED', amount: 45, startDate: '2026-01-01' }))).status).toBe(404);
  });

  it('are taken once per worker per run: pre-tax first, percent of gross, after-tax last', async () => {
    as(admin);
    runId = (await (await CREATE_RUN(req('POST', { frequency: 'BIWEEKLY', periodEnd: '2026-10-11', payDate: '2026-10-16' }))).json()).id;
    const r = await (await RUN(req('GET'), p(runId))).json();
    const adj = r.items.flatMap((i: RunItem) => i.adjustments.map((a) => `${i.workerName}:${a.kind}:${a.description}:${a.amount}`));
    expect(adj).toEqual(['Maria Lopez:PRETAX_DEDUCTION:Health insurance:45', 'Maria Lopez:PRETAX_DEDUCTION:401(k):80', 'Maria Lopez:DEDUCTION:Uniform rental:12']); // 5% of $1,600
    expect(r.totals).toMatchObject({ gross: 240000, pretax: 12500, taxableWages: 227500, deductions: 1200 });
  });

  it('follow bonuses for percent amounts, can’t be removed by hand, and stop at the annual limit', async () => {
    as(admin);
    const itemId = (await db.payrollItem.findFirst({ where: { runId, candidateId: maria } }))!.id;
    const bonus = await (await ADJ(req('POST', { itemId, kind: 'BONUS', description: 'Referral', amount: '400' }), p(runId))).json();
    const k = await db.payrollAdjustment.findFirst({ where: { deductionId: k401 } });
    expect(Number(k!.amount)).toBe(100); // 5% of $2,000
    expect((await (await UNADJ(req('DELETE'), p(k!.id))).json()).error).toBe('This comes from a recurring deduction. End or change it under Payroll → Recurring deductions.');
    expect((await (await ADJ(req('POST', { itemId, kind: 'PRETAX_DEDUCTION', description: 'x', amount: '5' }), p(runId))).json()).error).toBe('Choose a type.');
    await UNADJ(req('DELETE'), p(bonus.id));
    expect(Number((await db.payrollAdjustment.findFirst({ where: { deductionId: k401 } }))!.amount)).toBe(80);
    // Earlier this year $950 of the $1,000 limit was taken: only $50 is left.
    const prior = await db.payrollRun.create({ data: { organizationId: org, number: 'PR-OLD', frequency: 'WEEKLY', periodStart: new Date('2026-03-02'), periodEnd: new Date('2026-03-08'), payDate: new Date('2026-03-13'), status: 'PAID' } });
    const pi = await db.payrollItem.create({ data: { organizationId: org, runId: prior.id, timesheetId: 'old', applicationId: mariaApp, candidateId: maria, workerName: 'Maria Lopez', position: 'Packer', weekEnding: new Date('2026-03-08'), regularHours: 40, overtimeHours: 0, payRate: 20, billRate: 30, regularPay: 800, overtimePay: 0 } });
    await db.payrollAdjustment.create({ data: { organizationId: org, itemId: pi.id, kind: 'PRETAX_DEDUCTION', description: '401(k)', amount: 950, deductionId: k401, code: '401K' } });
    await ACT(req('PATCH', { action: 'refresh' }), p(runId));
    expect(await db.payrollAdjustment.findFirst({ where: { deductionId: k401, item: { runId } } })).toMatchObject({ description: '401(k) (Reached this year’s limit.)' });
    expect(Number((await db.payrollAdjustment.findFirst({ where: { deductionId: k401, item: { runId } } }))!.amount)).toBe(50);
  });

  it('are left out of export files unless turned on', async () => {
    as(admin);
    await ACT(req('PATCH', { action: 'approve', acknowledge: true }), p(runId));
    const off = await (await EXPORT(req('GET', undefined, 'http://x?format=csv'), p(runId))).text();
    expect(off.split('\r\n')[0]).not.toContain('Pre-tax deductions');
    expect(off).not.toContain('Uniform rental');
    await SETTINGS(req('PATCH', { provider: 'csv', companyCode: null, exportDeductions: true }));
    const on = await (await EXPORT(req('GET', undefined, 'http://x?format=csv'), p(runId))).text();
    const head = on.split('\r\n')[0].split(','), maria1 = on.split('\r\n').find((l) => l.includes('Maria'))!.split(',');
    expect(maria1[head.indexOf('Pre-tax deductions')]).toBe('95.00');
    expect(maria1[head.indexOf('After-tax deductions')]).toBe('12.00');
    const px = await (await EXPORT(req('GET', undefined, 'http://x?format=paychex'), p(runId))).text();
    expect(px.split('\r\n').filter((l) => /,(MED|401K|DED),/.test(l)).map((l) => l.split(',').slice(4, 8).join(' '))).toEqual(['MED   45.00', '401K   50.00', 'DED   12.00']);
  });

  it('end from a date, and draft runs paid later drop them', async () => {
    as(admin);
    const med = (await db.payDeduction.findFirst({ where: { candidateId: maria, type: 'MEDICAL' } }))!.id;
    expect((await END(req('PATCH', { endDate: '2026-10-31' }), p(med))).status).toBe(200);
    const nov = (await (await CREATE_RUN(req('POST', { frequency: 'WEEKLY', periodEnd: '2026-11-08', payDate: '2026-11-13' }))).json()).id;
    await db.timesheet.create({ data: { organizationId: org, applicationId: mariaApp, weekEnding: new Date('2026-11-08T00:00:00Z'), regularHours: 30, payRate: 20, billRate: 30, status: 'APPROVED' } });
    await db.timesheet.create({ data: { organizationId: org, applicationId: jamesApp, weekEnding: new Date('2026-11-08T00:00:00Z'), regularHours: 30, payRate: 20, billRate: 30, status: 'APPROVED' } });
    await ACT(req('PATCH', { action: 'refresh' }), p(nov));
    const adj = (await db.payrollAdjustment.findMany({ where: { item: { runId: nov } }, include: { item: true } })).map((a) => `${a.item.workerName}:${a.description}`).sort();
    expect(adj).toEqual(['James Carter:Dental insurance', 'Maria Lopez:Uniform rental']); // 401(k) limit reached; medical ended; dental started
    // A deduction never taken can be removed by ending it before it starts.
    const dental = (await db.payDeduction.findFirst({ where: { candidateId: james } }))!.id;
    await db.payrollAdjustment.deleteMany({ where: { deductionId: dental } });
    await END(req('PATCH', { endDate: '2026-10-01' }), p(dental));
    expect(await db.payDeduction.count({ where: { id: dental } })).toBe(0);
    as(oUser, other);
    expect((await END(req('PATCH', { endDate: '2026-10-31' }), p(med))).status).toBe(404);
  });
});

describe('Check sync', () => {
  it('creates benefits and post-tax deductions on the employee once, and sends an end date once', async () => {
    process.env.CHECK_API_KEY = 'sk_test';
    const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
    const real = globalThis.fetch;
    let n = 0;
    globalThis.fetch = vi.fn(async (url: string, init: RequestInit = {}) => { calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : {} }); return new Response(JSON.stringify({ id: `x_${++n}` })); }) as never;
    try {
      const tdb = tenantDb(org);
      await syncDeductions(tdb, new Map([[maria, 'emp_m']]));
      expect(calls.map((c) => `${c.method} ${c.url.replace('https://sandbox.checkhq.com', '')} ${c.body.benefit ?? c.body.type}`)).toEqual(['POST /benefits 125_medical', 'POST /benefits 401k', 'POST /post_tax_deductions miscellaneous']);
      expect(calls[1].body).toMatchObject({ employee: 'emp_m', employee_contribution_percent: 5, employee_contribution_annual_limit: '1000.00', effective_start: '2026-01-01' });
      expect(calls[0].body).toMatchObject({ employee_contribution_amount: '45.00', effective_end: '2026-10-31' });
      calls.length = 0;
      await syncDeductions(tdb, new Map([[maria, 'emp_m']]));
      expect(calls).toEqual([]); // nothing new
      const uni = (await db.payDeduction.findFirst({ where: { candidateId: maria, type: 'OTHER' } }))!;
      await tdb.payDeduction.updateMany({ where: { id: uni.id }, data: { endDate: new Date('2026-12-31') } });
      await syncDeductions(tdb, new Map([[maria, 'emp_m']]));
      expect(calls.map((c) => `${c.method} ${c.url.replace('https://sandbox.checkhq.com', '')} ${c.body.effective_end}`)).toEqual([`PATCH /post_tax_deductions/${uni.providerId!.split('|')[0].split(':')[1]} 2026-12-31`]);
    } finally { globalThis.fetch = real; delete process.env.CHECK_API_KEY; }
  });
});

describe('export layout', () => {
  it('keeps old import templates unchanged when there are no recurring deductions', () => {
    const item: RunItem = { id: 'i', candidateId: 'c', workerName: 'A B', payrollId: 'E', position: 'P', clientId: null, clientName: null, weekEnding: '2026-10-11', regularHours: 1, overtimeHours: 0, payRate: 10, billRate: 15, regularPay: 10, overtimePay: 0, adjustments: [] };
    const run = { number: 'PR', periodStart: '2026-10-05', periodEnd: '2026-10-11', payDate: '2026-10-16' };
    expect(exportRun('csv', run, [item], { deductions: true }).split('\r\n')[0]).toBe(exportRun('csv', run, [item]).split('\r\n')[0]);
  });
});
