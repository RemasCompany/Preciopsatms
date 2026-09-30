import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));

import { db } from '@/lib/db';
import { POST as CREATE } from '@/app/api/payroll/runs/route';
import { GET as RUN, PATCH as ACT } from '@/app/api/payroll/runs/[id]/route';
import { POST as ADJ } from '@/app/api/payroll/runs/[id]/adjustments/route';
import { DELETE as UNADJ } from '@/app/api/payroll/adjustments/[id]/route';
import { GET as EXPORT } from '@/app/api/payroll/runs/[id]/export/route';
import { GET as SUMMARIES } from '@/app/api/payroll/runs/[id]/statements/route';
import { GET as INVOICE } from '@/app/api/payroll/runs/[id]/invoice/route';
import { POST as TIMESHEETS } from '@/app/api/timesheets/approve/route';
import { exportRun, runChecks, totals, wages, type RunItem } from '@/lib/payroll-run';

const item = (o: Partial<RunItem> = {}): RunItem => ({
  id: 'i1', candidateId: 'c1', workerName: 'Maria Lopez', payrollId: 'E100', position: 'ICU RN', clientId: 'k1', clientName: 'St. Mary’s', weekEnding: '2026-09-27',
  regularHours: 36, overtimeHours: 0, payRate: 58, billRate: 82, regularPay: 2088, overtimePay: 0, adjustments: [], ...o,
});

describe('payroll math', () => {
  it('pays overtime at 1.5x and rounds each line to the cent', () => {
    expect(wages(40, 4.25, 18.33)).toEqual({ regular: 73320, overtime: 11685 }); // 4.25 × 27.495 = 116.85375
  });
  it('totals wages, bonuses, reimbursements, deductions and margin', () => {
    const t = totals([
      item({ adjustments: [{ id: 'a', kind: 'BONUS', description: 'Referral', amount: 100 }, { id: 'b', kind: 'REIMBURSEMENT', description: 'Mileage', amount: 23.45 }] }),
      item({ id: 'i2', weekEnding: '2026-09-20', regularHours: 40, overtimeHours: 2, regularPay: 2320, overtimePay: 174, adjustments: [{ id: 'c', kind: 'DEDUCTION', description: 'Scrubs', amount: 30 }] }),
    ]);
    expect(t).toMatchObject({ hours: 78, overtimeHours: 2, wages: 458200, extraTaxable: 10000, gross: 468200, reimbursements: 2345, deductions: 3000, billable: (36 * 82 + 40 * 82 + 2 * 123) * 100 });
    expect(t.margin).toBe(t.billable - t.wages);
  });
});

describe('checks before approving', () => {
  it('catches overtime owed across assignments, low rates and missing IDs', () => {
    const checks = runChecks([
      item({ candidateId: 'c2', workerName: 'James Carter', payrollId: null, position: 'Forklift', regularHours: 30, payRate: 18.5, billRate: 27 }),
      item({ id: 'x', candidateId: 'c2', workerName: 'James Carter', payrollId: null, position: 'Dock', regularHours: 16, payRate: 7, billRate: 6 }),
    ], [{ worker: 'Tom Nguyen', weekEnding: '2026-09-27', status: 'DRAFT' }]);
    const text = checks.map((c) => `${c.level}: ${c.text}`);
    expect(text).toEqual([
      'warn: James Carter: 46 regular hours the week ending 2026-09-27 across assignments — hours over 40 must be paid as overtime. Fix the timesheet split before approving.',
      'warn: James Carter: $7.00/hr on Dock is below the federal minimum wage ($7.25). Many states require more.',
      'warn: James Carter: bill rate ($6.00) is below pay rate ($7.00) on Dock.',
      'info: James Carter has no payroll employee ID. Add it on their candidate record so the import matches the right person.',
      'info: Tom Nguyen: the week ending 2026-09-27 is a draft timesheet and isn’t in this run. Approve it and refresh the run to include it.',
    ]);
  });
});

describe('provider exports', () => {
  const run = { number: 'PR-0007', periodStart: '2026-09-21', periodEnd: '2026-09-27', payDate: '2026-10-02' };
  const items = [
    item({ adjustments: [{ id: 'a', kind: 'BONUS', description: 'Referral', amount: 100 }, { id: 'b', kind: 'REIMBURSEMENT', description: 'Parking', amount: 12.5 }] }),
    item({ id: 'i2', position: 'Float pool', payRate: 62, regularHours: 4, regularPay: 248, overtimeHours: 1, overtimePay: 93 }),
    item({ id: 'i3', candidateId: 'c2', workerName: '=HYPERLINK("x")', payrollId: null, regularHours: 10, payRate: 20, regularPay: 200 }),
  ];
  it('ADP: one row per worker and rate, extras on the first row, company code and batch', () => {
    const rows = exportRun('adp', run, items, { companyCode: 'XYZ' }).trim().split('\r\n');
    expect(rows[0]).toBe('Co Code,Batch ID,File #,Employee Name,Rate 1,Reg Hours,O/T Hours,Earnings 3 Code,Earnings 3 Amount,Earnings 4 Code,Earnings 4 Amount,Earnings 5 Code,Earnings 5 Amount,Memo Code,Memo Amount');
    expect(rows[1]).toBe('XYZ,PR-0007,,"\'=HYPERLINK(""x"")",20.00,10.00,0.00,,,,,,,,');
    expect(rows[2]).toBe('XYZ,PR-0007,E100,"Lopez, Maria",58.00,36.00,0.00,BON,100.00,,,REIMB,12.50,,');
    expect(rows[3]).toBe('XYZ,PR-0007,E100,"Lopez, Maria",62.00,4.00,1.00,,,,,,,,');
  });
  it('Paychex and QuickBooks: one row per earning', () => {
    const px = exportRun('paychex', run, items).trim().split('\r\n');
    expect(px.filter((r) => r.includes('E100')).map((r) => r.split(',').slice(4, 8).join(' '))).toEqual(['REG 36.00 58.00 2088.00', 'BON   100.00', 'REIMB   12.50', 'REG 4.00 62.00 248.00', 'OT 1.00 93.0000 93.00']);
    const qb = exportRun('quickbooks', run, items);
    expect(qb).toContain('Maria Lopez,E100,Overtime Pay,1.00,93.0000,93.00,2026-09-21,2026-09-27,2026-10-02,Float pool');
    expect(qb).toContain('Maria Lopez,E100,Reimbursement,,,12.50,');
  });
  it('Standard CSV and Gusto carry gross, reimbursements and deductions', () => {
    const std = exportRun('csv', run, items).split('\r\n');
    expect(std.find((r) => r.includes('E100'))).toContain(',2088.00,0.00,100.00,0.00,2188.00,12.50,0.00,Bonus: Referral; Reimbursement: Parking');
    expect(exportRun('gusto', run, items).split('\r\n')[0]).toBe('first_name,last_name,employee_id,regular_hours,overtime_hours,rate,bonus,other_earnings,reimbursement,post_tax_deduction,notes');
  });
});

// ---- API ----
const RUN_ID = `pr${Date.now()}`;
let ent: string, growth: string, other: string, admin: string, rec: string, gUser: string, oUser: string;
let maria: string, james: string, tom: string, client: string;
const as = (u: string, o = ent) => { session.current = { user: { id: u, orgId: o } }; };
const req = (method: string, body?: object, url = 'http://x') => new Request(url, { method, body: body ? JSON.stringify(body) : undefined });
const p = (id: string) => ({ params: { id } });
const W1 = '2026-09-20', W2 = '2026-09-27';

beforeAll(async () => {
  const mk = (n: string, plan: 'enterprise' | 'growth') => db.organization.create({ data: { name: n, slug: `${n}-${RUN_ID}`, plan, subscriptionStatus: 'active', payrollCompanyCode: 'ACME1' } }).then((o) => o.id);
  [ent, growth, other] = await Promise.all([mk('acme', 'enterprise'), mk('grow', 'growth'), mk('other', 'enterprise')]);
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN_ID}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [admin, rec, gUser, oUser] = await Promise.all([u('admin'), u('rec'), u('grow'), u('other')]);
  await db.membership.createMany({ data: [
    { userId: admin, organizationId: ent, role: 'ADMIN' }, { userId: rec, organizationId: ent, role: 'RECRUITER' },
    { userId: gUser, organizationId: growth, role: 'OWNER' }, { userId: oUser, organizationId: other, role: 'OWNER' },
  ] });
  client = (await db.client.create({ data: { organizationId: ent, name: 'St. Mary’s', paymentTerms: 'Net 30' } })).id;
  const rn = await db.job.create({ data: { organizationId: ent, clientId: client, title: 'ICU RN', type: 'CONTRACT', payRate: 58, billRate: 82 } });
  const fork = await db.job.create({ data: { organizationId: ent, title: 'Forklift', type: 'TEMP', payRate: 18.5, billRate: 27 } });
  const c = (name: string, payrollId?: string) => db.candidate.create({ data: { organizationId: ent, name, payrollId } }).then((x) => x.id);
  const [cm, cj, ct] = await Promise.all([c('Maria Lopez', 'E100'), c('James Carter', 'E200'), c('Tom Nguyen')]);
  const a = (candidateId: string, jobId: string, orgId = ent) => db.application.create({ data: { organizationId: orgId, candidateId, jobId, stage: 'PLACED' } }).then((x) => x.id);
  [maria, james, tom] = await Promise.all([a(cm, rn.id), a(cj, fork.id), a(ct, fork.id)]);
  const ts = (applicationId: string, week: string, reg: number, ot: number, pay: number, bill: number, status: 'DRAFT' | 'APPROVED', orgId = ent) =>
    db.timesheet.create({ data: { organizationId: orgId, applicationId, weekEnding: new Date(`${week}T00:00:00Z`), regularHours: reg, overtimeHours: ot, payRate: pay, billRate: bill, status } });
  await ts(maria, W2, 36, 0, 58, 82, 'APPROVED');
  await ts(maria, W1, 36, 0, 58, 82, 'APPROVED');
  await ts(james, W2, 40, 4, 18.5, 27, 'APPROVED');
  await ts(tom, W2, 32, 0, 18.5, 27, 'DRAFT');
  // Another company's approved hours in the same week must never be pulled in.
  const oc = await db.candidate.create({ data: { organizationId: other, name: 'Other Worker' } });
  const oj = await db.job.create({ data: { organizationId: other, title: 'X', type: 'TEMP' } });
  await ts(await a(oc.id, oj.id, other), W2, 40, 0, 20, 30, 'APPROVED', other);
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN_ID } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN_ID}.test` } } });
  await db.$disconnect();
});

describe('payroll runs API', () => {
  let runId: string;
  const create = (body: object) => CREATE(req('POST', { frequency: 'WEEKLY', periodEnd: W2, payDate: '2026-10-02', ...body }));

  it('is Enterprise-only and admin-only', async () => {
    as(gUser, growth);
    expect((await create({})).status).toBe(402);
    as(rec);
    expect((await create({})).status).toBe(403);
  });

  it('starts a run from this company’s approved timesheets in the period', async () => {
    as(admin);
    expect((await (await create({ periodEnd: '2026-09-26' })).json()).error).toBe('Pay periods end on a Sunday. Choose a Sunday.');
    const res = await create({});
    expect(res.status).toBe(201);
    const body = await res.json();
    runId = body.id;
    expect(body).toMatchObject({ number: 'PR-0001', included: 2 });
    const run = await (await RUN(req('GET'), p(runId))).json();
    expect(run.items.map((i: RunItem) => `${i.workerName} ${i.weekEnding}`)).toEqual(['James Carter 2026-09-27', 'Maria Lopez 2026-09-27']);
    expect(run.totals).toMatchObject({ wages: (40 * 18.5 + 4 * 27.75 + 36 * 58) * 100 });
    expect(run.checks.map((c: { text: string }) => c.text).join(' ')).toMatch(/Tom Nguyen: the week ending 2026-09-27 is a draft timesheet/);
    expect(await db.timesheet.count({ where: { organizationId: other, payrollRunId: { not: null } } })).toBe(0);
    expect((await create({ frequency: 'BIWEEKLY' })).status).toBe(409);
  });

  it('takes bonuses, reimbursements and deductions on a draft', async () => {
    as(admin);
    const run = await (await RUN(req('GET'), p(runId))).json();
    const mItem = run.items.find((i: RunItem) => i.workerName === 'Maria Lopez').id;
    const bad = await ADJ(req('POST', { itemId: mItem, kind: 'BONUS', description: '', amount: 50 }), p(runId));
    expect((await bad.json()).error).toBe('Describe it, e.g. “Referral bonus”.');
    expect((await (await ADJ(req('POST', { itemId: mItem, kind: 'BONUS', description: 'x', amount: 1.234 }), p(runId))).json()).error).toBe('Use dollars and cents, like 125.50.');
    expect((await ADJ(req('POST', { itemId: mItem, kind: 'BONUS', description: 'Referral bonus', amount: 150 }), p(runId))).status).toBe(201);
    const r2 = await (await ADJ(req('POST', { itemId: mItem, kind: 'REIMBURSEMENT', description: 'Parking', amount: '24.50' }), p(runId))).json();
    const tmp = await (await ADJ(req('POST', { itemId: mItem, kind: 'DEDUCTION', description: 'Oops', amount: 5 }), p(runId))).json();
    expect((await UNADJ(req('DELETE'), p(tmp.id))).status).toBe(200);
    const after = await (await RUN(req('GET'), p(runId))).json();
    expect(after.totals).toMatchObject({ extraTaxable: 15000, reimbursements: 2450, deductions: 0 });
    expect(r2.id).toBeTruthy();
  });

  it('picks up newly approved hours on refresh and drops reopened ones', async () => {
    as(admin);
    await TIMESHEETS(req('POST', { week: W2, action: 'approve', applicationIds: [tom] }));
    expect((await (await ACT(req('PATCH', { action: 'refresh' }), p(runId))).json())).toMatchObject({ included: 3, dropped: 0 });
    await TIMESHEETS(req('POST', { week: W2, action: 'reopen', applicationIds: [tom] }));
    const run = await (await RUN(req('GET'), p(runId))).json();
    expect(run.items).toHaveLength(2);
    expect(await db.timesheet.count({ where: { applicationId: tom, payrollRunId: { not: null } } })).toBe(0);
  });

  it('asks before approving with warnings, then locks the run', async () => {
    as(admin);
    await db.timesheet.updateMany({ where: { applicationId: james, weekEnding: new Date(`${W2}T00:00:00Z`) }, data: { payRate: 7 } });
    await ACT(req('PATCH', { action: 'refresh' }), p(runId));
    const first = await ACT(req('PATCH', { action: 'approve' }), p(runId));
    expect(first.status).toBe(409);
    expect((await first.json()).warnings[0].text).toMatch(/below the federal minimum wage/);
    await db.timesheet.updateMany({ where: { applicationId: james, weekEnding: new Date(`${W2}T00:00:00Z`) }, data: { payRate: 18.5 } });
    expect((await (await ACT(req('PATCH', { action: 'approve' }), p(runId))).json()).ok).toBe(true);
    expect((await db.payrollRun.findUnique({ where: { id: runId } }))!.status).toBe('APPROVED');
    const item = (await db.payrollItem.findFirst({ where: { runId } }))!;
    expect((await ADJ(req('POST', { itemId: item.id, kind: 'BONUS', description: 'Late', amount: 5 }), p(runId))).status).toBe(409);
    const reopen = await TIMESHEETS(req('POST', { week: W2, action: 'reopen', applicationIds: [maria] }));
    expect([reopen.status, (await reopen.json()).error]).toEqual([409, 'These hours are in payroll run PR-0001. Reopen or void the run first.']);
  });

  it('exports for the provider, prints pay summaries and invoices clients', async () => {
    as(admin);
    const adp = await EXPORT(req('GET', undefined, 'http://x?format=adp'), p(runId));
    expect(adp.headers.get('content-disposition')).toContain('PR-0001-adp.csv');
    const text = await adp.text();
    expect(text).toContain('ACME1,PR-0001,E100,"Lopez, Maria",58.00,36.00,0.00,BON,150.00,,,REIMB,24.50,,');
    expect(text).toContain('ACME1,PR-0001,E200,"Carter, James",18.50,40.00,4.00');
    const pdf = await SUMMARIES(req('GET'), p(runId));
    expect([pdf.headers.get('content-type'), (await pdf.arrayBuffer()).byteLength > 1000]).toEqual(['application/pdf', true]);
    const inv = await INVOICE(req('GET', undefined, `http://x?client=${client}`), p(runId));
    expect(inv.headers.get('content-disposition')).toContain('INV-0001-STMA.pdf');
  });

  it('never exposes a run to another company', async () => {
    as(oUser, other);
    expect((await RUN(req('GET'), p(runId))).status).toBe(404);
    expect((await ACT(req('PATCH', { action: 'void' }), p(runId))).status).toBe(404);
    expect((await EXPORT(req('GET', undefined, 'http://x?format=csv'), p(runId))).status).toBe(404);
    const item = (await db.payrollItem.findFirst({ where: { runId } }))!;
    expect((await ADJ(req('POST', { itemId: item.id, kind: 'BONUS', description: 'x', amount: 5 }), p(runId))).status).toBe(404);
  });

  it('marks paid (timesheets too) and then refuses to void', async () => {
    as(admin);
    expect((await (await ACT(req('PATCH', { action: 'pay' }), p(runId))).json()).ok).toBe(true);
    expect(await db.timesheet.count({ where: { payrollRunId: runId, status: 'PAID' } })).toBe(2);
    const v = await ACT(req('PATCH', { action: 'void' }), p(runId));
    expect([v.status, (await v.json()).error]).toEqual([409, 'This run is paid, so it can’t be voided.']);
  });

  it('voiding a run releases its timesheets for a new run', async () => {
    as(admin);
    const r = await (await CREATE(req('POST', { frequency: 'WEEKLY', periodEnd: W1, payDate: '2026-09-25' }))).json();
    expect(r).toMatchObject({ number: 'PR-0002', included: 1 });
    await ACT(req('PATCH', { action: 'void' }), p(r.id));
    expect(await db.timesheet.count({ where: { applicationId: maria, weekEnding: new Date(`${W1}T00:00:00Z`), payrollRunId: null } })).toBe(1);
    const again = await (await CREATE(req('POST', { frequency: 'WEEKLY', periodEnd: W1, payDate: '2026-09-25' }))).json();
    expect(again).toMatchObject({ number: 'PR-0003', included: 1 });
  });
});
