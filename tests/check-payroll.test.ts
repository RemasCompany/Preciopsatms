import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));

import { db } from '@/lib/db';
import { POST as CREATE } from '@/app/api/payroll/runs/route';
import { PATCH as ACT } from '@/app/api/payroll/runs/[id]/route';
import { POST as ADJ } from '@/app/api/payroll/runs/[id]/adjustments/route';
import { GET as CONN, POST as CONNECT, DELETE as DISCONNECT } from '@/app/api/payroll/connection/route';
import { POST as PROVIDER } from '@/app/api/payroll/runs/[id]/provider/route';
import { POST as SETUP_LINK } from '@/app/api/payroll/workers/[candidateId]/setup-link/route';
import { GET as SETUP } from '@/app/api/public/payroll-setup/[token]/route';
import { POST as HOOK } from '@/app/api/webhooks/check/route';
import { errorText, payrollItems, readPreview, splitName } from '@/lib/check-payroll';
import type { RunItem } from '@/lib/payroll-run';

const RUN = `chk${Date.now()}`;
let org: string, other: string, owner: string, admin: string, oUser: string, maria: string, james: string;
const calls: { url: string; method: string; body: Record<string, unknown> | null; auth: string }[] = [];
const realFetch = globalThis.fetch;
// A tiny stand-in for Check's sandbox.
const check = { employees: new Map<string, string>(), payrolls: new Map<string, string>(), company: 'blocking', n: 0 };
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const req = (method: string, body?: object) => new Request('http://x', { method, body: body ? JSON.stringify(body) : undefined });
const p = (id: string) => ({ params: { id } });
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const SECRET = 'whsec_test';
const hook = (ev: object, secret = SECRET) => { const raw = JSON.stringify(ev); return HOOK(new Request('http://x', { method: 'POST', headers: { 'x-checkhq-signature': createHmac('sha256', secret).update(raw).digest('hex') }, body: raw })); };

const item = (o: Partial<RunItem> = {}): RunItem => ({
  id: 'i1', candidateId: 'c1', workerName: 'Maria Lopez', payrollId: null, position: 'ICU RN', clientId: null, clientName: null, weekEnding: '2026-09-27',
  regularHours: 36, overtimeHours: 2, payRate: 58, billRate: 82, regularPay: 2088, overtimePay: 174, adjustments: [], ...o,
});

beforeAll(async () => {
  const mk = (n: string) => db.organization.create({ data: { name: n, slug: `${n}-${RUN}`, plan: 'enterprise', subscriptionStatus: 'active' } }).then((o) => o.id);
  [org, other] = await Promise.all([mk('acme'), mk('other')]);
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [owner, admin, oUser] = await Promise.all([u('owner'), u('admin'), u('other')]);
  await db.membership.createMany({ data: [{ userId: owner, organizationId: org, role: 'OWNER' }, { userId: admin, organizationId: org, role: 'ADMIN' }, { userId: oUser, organizationId: other, role: 'OWNER' }] });
  const job = await db.job.create({ data: { organizationId: org, title: 'ICU RN', type: 'CONTRACT', payRate: 58, billRate: 82 } });
  maria = (await db.candidate.create({ data: { organizationId: org, name: 'Maria de la Cruz', email: 'maria@x.test', phone: '4075550100' } })).id;
  james = (await db.candidate.create({ data: { organizationId: org, name: 'James Carter', email: 'james@x.test', payrollId: 'E200' } })).id;
  for (const c of [maria, james]) {
    const a = await db.application.create({ data: { organizationId: org, candidateId: c, jobId: job.id, stage: 'PLACED' } });
    await db.timesheet.create({ data: { organizationId: org, applicationId: a.id, weekEnding: new Date('2026-09-27T00:00:00Z'), regularHours: 40, overtimeHours: c === maria ? 2 : 0, payRate: 58, billRate: 82, status: 'APPROVED' } });
  }
  globalThis.fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body, auth: (init.headers as Record<string, string>)?.Authorization });
    const path = url.replace('https://sandbox.checkhq.com', '');
    if (path === '/companies' && method === 'POST') return json({ id: 'com_acme', legal_name: body.legal_name });
    if (path === '/companies/com_acme') return json({ id: 'com_acme', legal_name: 'Acme Staffing LLC', onboard: { status: check.company, blocking_steps: check.company === 'blocking' ? ['ein', 'bank_account'] : [] } });
    if (path === '/companies/com_missing') return json({ error: { message: 'Company not found.' } }, 404);
    if (path === '/workplaces' && method === 'POST') return json({ id: 'wrk_1' });
    if (path === '/companies/com_acme/components/onboard') return json({ url: 'https://components.checkhq.com/company-onboard?t=1' });
    if (path === '/employees' && method === 'POST') { const id = `emp_${++check.n}`; check.employees.set(id, 'blocking'); return json({ id, onboard: { status: 'blocking', blocking_steps: ['ssn', 'withholdings'] } }); }
    const emp = path.match(/^\/employees\/(emp_\d+)(\/components\/onboard)?$/);
    if (emp) return emp[2] ? json({ url: `https://components.checkhq.com/employee-onboard?e=${emp[1]}` }) : json({ id: emp[1], onboard: { status: check.employees.get(emp[1]), blocking_steps: [] } });
    if (path === '/payrolls' && method === 'POST') { const id = `pay_${++check.n}`; check.payrolls.set(id, 'draft'); return json({ id, status: 'draft' }); }
    const pay = path.match(/^\/payrolls\/(pay_\d+)(\/preview|\/approve)?$/);
    if (pay) {
      if (method === 'DELETE') { check.payrolls.delete(pay[1]); return new Response(null, { status: 204 }); }
      if (pay[2] === '/approve') { check.payrolls.set(pay[1], 'pending'); return json({ id: pay[1], status: 'pending' }); }
      if (pay[2] === '/preview') return json({ totals: { employee_gross: '4814.00', employee_taxes: '901.22', employee_net: '3912.78', company_taxes: '368.27', liability: '5182.27', employee_reimbursements: '0.00' }, approval_deadline: '2026-09-29T21:00:00Z', items: [] });
      return json({ id: pay[1], status: check.payrolls.get(pay[1]), company: 'com_acme' });
    }
    return json({ error: { message: 'Unexpected' } }, 500);
  }) as never;
});
afterEach(() => { delete process.env.CHECK_API_KEY; delete process.env.CHECK_WEBHOOK_SECRET; });
afterAll(async () => {
  globalThis.fetch = realFetch;
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('Check mapping', () => {
  it('splits names, reads errors and previews', () => {
    expect(splitName('Maria de la Cruz')).toEqual({ first_name: 'Maria', last_name: 'de la Cruz' });
    expect(splitName('Cher')).toEqual({ first_name: 'Cher', last_name: 'Cher' });
    expect(errorText({ error: { message: 'Invalid payroll.', input_errors: [{ message: 'must be a future date', field_path: ['payday'] }] } })).toBe('Invalid payroll. — payday: must be a future date');
    expect(readPreview({ totals: { employee_gross: '100.10', employee_taxes: '9.99', employee_net: '90.11', company_taxes: '7.65', liability: '107.75' } })).toMatchObject({ gross: 10010, employeeTaxes: 999, net: 9011, employerTaxes: 765, cashNeeded: 10775 });
  });

  it('sends the run’s own hours and amounts, one item per worker', () => {
    const r = payrollItems([
      item({ adjustments: [{ id: 'a', kind: 'BONUS', description: 'Referral', amount: 100 }, { id: 'b', kind: 'REIMBURSEMENT', description: 'Mileage', amount: 23.45 }] }),
      item({ id: 'i2', position: 'Float pool', regularHours: 4, overtimeHours: 0, regularPay: 248, overtimePay: 0, leaveHours: 8, leavePay: 464 }),
    ], new Map([['c1', 'emp_1']]), 'wrk_1');
    expect(r.problems).toEqual([]);
    expect(r.items).toEqual([{ employee: 'emp_1', reimbursements: [{ amount: '23.45', description: 'Mileage' }], earnings: [
      { type: 'hourly', hours: '36.00', amount: '2088.00', description: 'ICU RN · week ending 2026-09-27', workplace: 'wrk_1' },
      { type: 'overtime', hours: '2.00', amount: '174.00', description: 'ICU RN · week ending 2026-09-27', workplace: 'wrk_1' },
      { type: 'bonus', amount: '100.00', description: 'Referral', workplace: 'wrk_1' },
      { type: 'hourly', hours: '4.00', amount: '248.00', description: 'Float pool · week ending 2026-09-27', workplace: 'wrk_1' },
      { type: 'pto', hours: '8.00', amount: '464.00', description: 'Paid time off · week ending 2026-09-27', workplace: 'wrk_1' },
    ] }]);
  });

  it('holds back one-off deductions and workers who aren’t in Check', () => {
    const r = payrollItems([item({ adjustments: [{ id: 'd', kind: 'DEDUCTION', description: 'Scrubs', amount: 30 }] }), item({ id: 'x', candidateId: 'c2', workerName: 'Tom' })], new Map([['c1', 'emp_1']]), 'wrk_1');
    expect(r.problems).toEqual(['Maria Lopez: one-off deductions (“Scrubs”) aren’t sent to Check. Set it up as a post-tax deduction in Check, or remove it here.', 'Tom isn’t set up in Check yet.']);
  });
});

describe('payroll through Check', () => {
  let runId: string;
  it('is off until the server has a Check key', async () => {
    as(admin);
    expect(await (await CONN()).json()).toEqual({ available: false, live: false, connection: null });
    expect((await (await CONNECT(req('POST', { mode: 'link', companyId: 'com_acme' }))).json()).error).toBe('Payroll processing isn’t set up on this server yet (CHECK_API_KEY).');
  });

  it('creates the company in Check with a work location', async () => {
    process.env.CHECK_API_KEY = 'sk_test_1';
    as(admin);
    expect((await (await CONNECT(req('POST', { mode: 'create', legalName: 'Acme Staffing LLC', address: { line1: '1 Main St', city: 'Orlando', state: 'fl', postal_code: '3280' } }))).json()).error).toBe('Enter a 5-digit ZIP code.');
    calls.length = 0;
    const r = await CONNECT(req('POST', { mode: 'create', legalName: 'Acme Staffing LLC', address: { line1: '1 Main St', city: 'Orlando', state: 'fl', postal_code: '32801' } }));
    expect(r.status).toBe(200);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST https://sandbox.checkhq.com/companies', 'POST https://sandbox.checkhq.com/workplaces', 'GET https://sandbox.checkhq.com/companies/com_acme']);
    expect(calls[0].auth).toBe('Bearer sk_test_1');
    expect(calls[1].body).toEqual({ company: 'com_acme', name: 'Main office', address: { line1: '1 Main St', city: 'Orlando', state: 'FL', postal_code: '32801' } });
    expect((await (await CONN()).json()).connection).toMatchObject({ companyName: 'Acme Staffing LLC', status: 'blocking', missing: ['EIN', 'bank account'] });
    expect((await CONNECT(req('POST', { mode: 'link', companyId: 'com_acme' }))).status).toBe(409);
    expect((await (await CONNECT(req('POST', { action: 'setupUrl' }))).json()).url).toBe('https://components.checkhq.com/company-onboard?t=1');
    // Another firm can't link the same company.
    as(oUser, other);
    expect((await (await CONNECT(req('POST', { mode: 'link', companyId: 'com_acme' }))).json()).error).toBe('That Check company is already connected to another account.');
    expect((await (await CONN()).json()).connection).toBeNull();
  });

  it('waits for the company setup, then for each worker’s own setup', async () => {
    process.env.CHECK_API_KEY = 'sk_test_1';
    as(admin);
    runId = (await (await CREATE(req('POST', { frequency: 'WEEKLY', periodEnd: '2026-09-27', payDate: '2026-10-02' }))).json()).id;
    expect((await (await PROVIDER(req('POST', { action: 'send' }), p(runId))).json()).error).toBe('Approve the run here first, then send it to Check.');
    await ACT(req('PATCH', { action: 'approve', acknowledge: true }), p(runId));
    expect((await (await PROVIDER(req('POST', { action: 'send' }), p(runId))).json()).error).toBe('Finish your company’s setup in Check first (still needed: EIN, bank account).');
    check.company = 'completed';
    calls.length = 0;
    const r = await PROVIDER(req('POST', { action: 'send' }), p(runId));
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.notReady.map((w: { name: string; missing: string[] }) => [w.name, w.missing])).toEqual([['James Carter', ['Social Security number', 'tax withholdings (W-4)']], ['Maria de la Cruz', ['Social Security number', 'tax withholdings (W-4)']]]);
    const created = calls.filter((c) => c.url.endsWith('/employees'));
    expect(created.map((c) => c.body)).toContainEqual({ company: 'com_acme', first_name: 'Maria', last_name: 'de la Cruz', email: 'maria@x.test', start_date: '2026-09-21', workplaces: ['wrk_1'], primary_workplace: 'wrk_1' });
    // Only name, email and start date go to Check; the worker enters SSN and bank details there.
    expect(JSON.stringify(created)).not.toContain('4075550100');
    // A worker without a payroll ID gets Check's; one with an ID keeps it.
    expect((await db.candidate.findUnique({ where: { id: maria } }))?.payrollId).toMatch(/^emp_/);
    expect((await db.candidate.findUnique({ where: { id: james } }))?.payrollId).toBe('E200');
  });

  it('sends workers a private setup link that opens a fresh Check page', async () => {
    process.env.CHECK_API_KEY = 'sk_test_1';
    as(admin);
    const r = await (await SETUP_LINK(req('POST', { channels: ['email'] }), { params: { candidateId: maria } })).json();
    expect(r).toMatchObject({ ok: true, sent: ['email'] });
    const msg = await db.message.findFirst({ where: { organizationId: org, relatedId: maria }, orderBy: { createdAt: 'desc' } });
    const token = msg!.body.match(/payroll-setup\/([\w-]+)/)![1];
    const empId = (await db.payrollWorker.findFirst({ where: { candidateId: maria } }))!.externalId;
    const open = await SETUP(new Request('http://x'), { params: { token } });
    expect(open.status).toBe(302);
    expect(open.headers.get('location')).toBe(`https://components.checkhq.com/employee-onboard?e=${empId}`);
    expect((await SETUP(new Request('http://x'), { params: { token: 'nope' } })).status).toBe(404);
    // Opted-out workers aren't emailed.
    await db.candidate.update({ where: { id: james }, data: { emailOptOut: true } });
    expect((await SETUP_LINK(req('POST', { channels: ['email'] }), { params: { candidateId: james } })).status).toBe(400);
    // Another firm can't send for this worker.
    as(oUser, other);
    expect((await SETUP_LINK(req('POST', { channels: ['email'] }), { params: { candidateId: maria } })).status).toBe(400);
  });

  it('sends, previews taxes and net pay, approves, and is marked paid by the webhook', async () => {
    process.env.CHECK_API_KEY = 'sk_test_1';
    process.env.CHECK_WEBHOOK_SECRET = SECRET;
    for (const k of check.employees.keys()) check.employees.set(k, 'completed');
    as(admin);
    calls.length = 0;
    const j = await (await PROVIDER(req('POST', { action: 'send' }), p(runId))).json();
    expect(j).toMatchObject({ ok: true, grossMatches: true, totals: { gross: 481400, employeeTaxes: 90122, net: 391278, employerTaxes: 36827, cashNeeded: 518227 } });
    const payroll = calls.find((c) => c.url.endsWith('/payrolls'))!.body!;
    expect(payroll).toMatchObject({ company: 'com_acme', period_start: '2026-09-21', period_end: '2026-09-27', payday: '2026-10-02' });
    expect((payroll.items as unknown[]).length).toBe(2);
    // Sending again replaces the draft.
    const first = (await db.payrollRun.findUnique({ where: { id: runId } }))!.providerPayrollId!;
    await PROVIDER(req('POST', { action: 'send' }), p(runId));
    expect(check.payrolls.has(first)).toBe(false);
    // Can't mark paid by hand once it's going through Check.
    expect((await (await ACT(req('PATCH', { action: 'pay' }), p(runId))).json()).error).toBe('This run was sent to Check, so it’s marked paid when Check pays it.');
    expect((await PROVIDER(req('POST', { action: 'approve' }), p(runId))).status).toBe(200);
    expect((await (await ACT(req('PATCH', { action: 'unapprove' }), p(runId))).json()).error).toBe('This run was approved in Check. Cancel it in Check first, then change it here.');
    expect((await (await ACT(req('PATCH', { action: 'void' }), p(runId))).json()).error).toBe('This run was approved in Check. Cancel it in Check first, then change it here.');
    const owner2 = await DISCONNECT();
    expect(owner2.status).toBe(403);
    as(owner);
    expect((await (await DISCONNECT()).json()).error).toBe('A payroll is being paid through Check right now. Disconnect after it’s paid.');

    const pid = (await db.payrollRun.findUnique({ where: { id: runId } }))!.providerPayrollId!;
    // A forged webhook is refused; a real one only nudges us to re-read Check.
    expect((await hook({ type: 'payroll.updated', data: { id: pid, status: 'paid' } }, 'wrong')).status).toBe(401);
    expect(await (await hook({ type: 'payroll.updated', data: { id: pid, status: 'paid' } })).json()).toEqual({ ok: true, applied: true });
    expect((await db.payrollRun.findUnique({ where: { id: runId } }))?.status).toBe('APPROVED'); // Check still says pending
    check.payrolls.set(pid, 'paid');
    await hook({ type: 'payroll.updated', data: { id: pid } });
    const run = await db.payrollRun.findUnique({ where: { id: runId } });
    expect(run).toMatchObject({ status: 'PAID', providerStatus: 'paid' });
    expect(await db.timesheet.count({ where: { payrollRunId: runId, status: 'PAID' } })).toBe(2);
    expect(await db.auditLog.count({ where: { organizationId: org, action: { in: ['payroll.connect', 'payroll.send', 'payroll.providerApprove'] } } })).toBe(4);
  });

  it('deletes the draft in Check when a run is reopened, and blocks one-off deductions', async () => {
    process.env.CHECK_API_KEY = 'sk_test_1';
    as(admin);
    const job = await db.job.create({ data: { organizationId: org, title: 'Dock', type: 'TEMP', payRate: 20, billRate: 30 } });
    const a = await db.application.create({ data: { organizationId: org, candidateId: maria, jobId: job.id, stage: 'PLACED' } });
    await db.timesheet.create({ data: { organizationId: org, applicationId: a.id, weekEnding: new Date('2026-10-04T00:00:00Z'), regularHours: 10, payRate: 20, billRate: 30, status: 'APPROVED' } });
    const id = (await (await CREATE(req('POST', { frequency: 'WEEKLY', periodEnd: '2026-10-04', payDate: '2026-10-09' }))).json()).id;
    await ACT(req('PATCH', { action: 'approve', acknowledge: true }), p(id));
    await PROVIDER(req('POST', { action: 'send' }), p(id));
    const pid = (await db.payrollRun.findUnique({ where: { id } }))!.providerPayrollId!;
    expect((await ACT(req('PATCH', { action: 'unapprove' }), p(id))).status).toBe(200);
    expect(check.payrolls.has(pid)).toBe(false);
    expect(await db.payrollRun.findUnique({ where: { id } })).toMatchObject({ providerPayrollId: null, providerStatus: null, providerTotals: null });
    const itemId = (await db.payrollItem.findFirst({ where: { runId: id } }))!.id;
    await ADJ(req('POST', { itemId, kind: 'DEDUCTION', description: 'Scrubs', amount: '30' }), p(id));
    await ACT(req('PATCH', { action: 'approve', acknowledge: true }), p(id));
    expect((await (await PROVIDER(req('POST', { action: 'send' }), p(id))).json()).error).toContain('one-off deductions (“Scrubs”) aren’t sent to Check');
  });
});
