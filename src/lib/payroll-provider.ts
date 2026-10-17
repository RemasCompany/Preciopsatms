import { z } from 'zod';
import { Prisma, type Organization, type PayrollConnection, type PayrollRun } from '@prisma/client';
import { db } from './db';
import { HttpError, logActivity, tenantDb, type TenantDb } from './tenant';
import { newToken, sha256 } from './tokens';
import { deliver, resolveWorkerLink, type Channel } from './schedule-server';
import { audit } from './audit';
import { loadRun } from './payroll-run-server';
import { totals } from './payroll-run';
import * as check from './check-payroll';
import { DEDUCTION_TYPES, type DeductionType } from './deductions';

/**
 * Running payroll through Check: the firm's company in Check, workers as Check employees (who set up their own
 * tax and bank details there), and each approved run sent as a Check payroll that is previewed (taxes, net pay,
 * cash needed), approved and then reported back as paid.
 */
const PROVIDER = 'check';
const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';
type Actor = { id: string; email: string; name?: string | null };

export const getConnection = (tdb: TenantDb) => tdb.payrollConnection.findFirst({ where: { provider: PROVIDER } });
async function needConnection(tdb: TenantDb) {
  const c = await getConnection(tdb);
  if (!c) throw new HttpError(400, 'Connect payroll processing first (Payroll → Payroll processing).');
  return c;
}

const Address = z.object({
  line1: z.string().trim().min(1, 'Enter the street address.').max(120), line2: z.string().trim().max(120).optional().nullable(),
  city: z.string().trim().min(1, 'Enter the city.').max(80), state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Use the two-letter state code.'),
  postal_code: z.string().trim().regex(/^\d{5}(-\d{4})?$/, 'Enter a 5-digit ZIP code.'),
});
export const ConnectBody = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('create'), legalName: z.string().trim().min(2, 'Enter the company’s legal name.').max(120), tradeName: z.string().trim().max(120).optional().nullable(), address: Address }),
  z.object({ mode: z.literal('link'), companyId: z.string().trim().regex(/^com_\w+$/, 'Check company IDs start with com_.'), address: Address.optional() }),
]);

/** Creates the firm's company in Check (or links one that already exists) with a work location. */
export async function connectCompany(tdb: TenantDb, org: Organization, user: Actor, b: z.infer<typeof ConnectBody>) {
  if (await getConnection(tdb)) throw new HttpError(409, 'Payroll processing is already connected.');
  let companyId: string, companyName: string, workplaceId: string | null = null;
  if (b.mode === 'create') {
    const co = await check.createCompany({ legalName: b.legalName, tradeName: b.tradeName ?? org.shortName ?? null, email: user.email, address: b.address });
    companyId = co.id; companyName = co.name;
  } else {
    // A company ID belongs to one firm only.
    if (await db.payrollConnection.findFirst({ where: { provider: PROVIDER, companyId: b.companyId } })) throw new HttpError(409, 'That Check company is already connected to another account.');
    const co = await check.getCompany(b.companyId);
    companyId = co.id; companyName = co.name;
    workplaceId = await check.firstWorkplace(companyId);
  }
  if (!workplaceId) {
    if (!b.address) throw new HttpError(400, 'That company has no work location in Check yet. Enter its address.');
    workplaceId = await check.createWorkplace(companyId, b.address, 'Main office');
  }
  const co = await check.getCompany(companyId).catch(() => null);
  await tdb.payrollConnection.create({ data: { provider: PROVIDER, companyId, companyName, workplaceId, onboardStatus: co?.onboard ?? 'blocking', checkedAt: new Date(), connectedById: user.id } as never });
  await audit(org.id, user, 'payroll.connect', `Connected payroll processing (Check company ${companyName})`, { targetType: 'payrollConnection', targetId: companyId });
  await logActivity(org.id, `Connected payroll processing with Check (${companyName})`, user.id);
  return { companyId, companyName };
}

/** Re-reads the company's setup status from Check. */
export async function refreshCompany(tdb: TenantDb, conn: PayrollConnection) {
  try {
    const co = await check.getCompany(conn.companyId);
    await tdb.payrollConnection.updateMany({ where: { id: conn.id }, data: { onboardStatus: co.onboard, companyName: co.name, checkedAt: new Date(), lastError: null } });
    return { status: co.onboard, missing: co.missing.map(check.stepLabel) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Check didn’t answer.';
    await tdb.payrollConnection.updateMany({ where: { id: conn.id }, data: { lastError: msg, checkedAt: new Date() } });
    return { status: conn.onboardStatus, missing: [] as string[], error: msg };
  }
}

export async function companySetupUrl(tdb: TenantDb) {
  return check.companyOnboardUrl((await needConnection(tdb)).companyId);
}

export async function disconnect(tdb: TenantDb, org: Organization, user: Actor) {
  const conn = await needConnection(tdb);
  const busy = await tdb.payrollRun.count({ where: { providerPayrollId: { not: null }, providerStatus: { in: ['pending', 'processing'] } } });
  if (busy) throw new HttpError(409, 'A payroll is being paid through Check right now. Disconnect after it’s paid.');
  await tdb.payrollConnection.deleteMany({ where: { id: conn.id } });
  await audit(org.id, user, 'payroll.disconnect', `Disconnected payroll processing (Check company ${conn.companyName ?? conn.companyId})`, { targetType: 'payrollConnection', targetId: conn.companyId });
}

// ---- workers ----
type W = { candidateId: string; name: string; email: string | null; startDate: string | null };

/** Adds workers to Check as employees if they aren't there yet, and refreshes where their own setup stands. */
export async function ensureWorkers(tdb: TenantDb, conn: PayrollConnection, workers: W[]) {
  const have = await tdb.payrollWorker.findMany({ where: { provider: PROVIDER, candidateId: { in: workers.map((w) => w.candidateId) } } });
  const out = new Map<string, { externalId: string; onboardStatus: string; missing: string[] }>();
  for (const w of workers) {
    const row = have.find((h) => h.candidateId === w.candidateId);
    if (!row) {
      const e = await check.createEmployee(conn.companyId, conn.workplaceId, w);
      await tdb.payrollWorker.create({ data: { provider: PROVIDER, candidateId: w.candidateId, externalId: e.id, onboardStatus: e.onboard, missing: e.missing } as never });
      // Use Check's employee ID to match exports too, unless the worker already has a payroll ID.
      await tdb.candidate.updateMany({ where: { id: w.candidateId, payrollId: null }, data: { payrollId: e.id } });
      out.set(w.candidateId, { externalId: e.id, onboardStatus: e.onboard, missing: e.missing });
    } else if (row.onboardStatus !== 'completed') {
      const e = await check.getEmployee(row.externalId);
      await tdb.payrollWorker.updateMany({ where: { id: row.id }, data: { onboardStatus: e.onboard, missing: e.missing, checkedAt: new Date() } });
      out.set(w.candidateId, { externalId: row.externalId, onboardStatus: e.onboard, missing: e.missing });
    } else out.set(w.candidateId, { externalId: row.externalId, onboardStatus: row.onboardStatus, missing: row.missing });
  }
  return out;
}

/** Emails or texts the worker a private link to set up their taxes and direct deposit in Check. */
export async function sendSetupLink(tdb: TenantDb, org: Organization, candidateId: string, channels: Channel[], user: Actor) {
  const pw = await tdb.payrollWorker.findFirst({ where: { provider: PROVIDER, candidateId } });
  if (!pw) throw new HttpError(400, 'Send a payroll run to Check first; that adds them as an employee.');
  const c = await tdb.candidate.findFirst({ where: { id: candidateId }, select: { id: true, name: true, email: true, phone: true, emailOptOut: true, smsOptOut: true } });
  if (!c) throw new HttpError(404, 'That person was deleted.');
  const token = newToken();
  await tdb.workerLink.create({ data: { candidateId, tokenHash: sha256(token), kind: 'payroll', expiresAt: new Date(Date.now() + 14 * 864e5) } as never });
  const link = `${appUrl()}/api/public/payroll-setup/${token}`, company = org.shortName ?? org.name, first = c.name.split(' ')[0] || 'there';
  const msg = (ch: Channel) => ch === 'sms'
    ? { subject: '', text: `${company}: set up your tax withholding and direct deposit so we can pay you: ${link}` }
    : { subject: `${company}: set up how you get paid`, text: `Hi ${first},\n\nBefore we can pay you, please set up your tax withholding (W-4) and how you’d like to be paid (direct deposit or paper check). It takes about five minutes:\n\n${link}\n\nThis opens our payroll provider, Check, where your Social Security number and bank details are kept — we never see them. The link is just for you and works for 14 days.\n\nThank you,\n${company}` };
  const sent: Channel[] = [], problems: string[] = [];
  for (const ch of channels) {
    const p = await deliver(tdb, c, ch, msg(ch), { name: company, replyTo: user.email }, user.id);
    if (p) problems.push(`${ch === 'sms' ? 'Text' : 'Email'}: ${p}`); else sent.push(ch);
  }
  return { sent, problems };
}

/** Opening the worker's link: a fresh one-time Check onboarding URL (they expire quickly, so one isn't stored). */
export async function workerSetupUrl(token: string) {
  const link = await resolveWorkerLink(token);
  if (!link || link.kind !== 'payroll') return null;
  const pw = await tenantDb(link.organizationId).payrollWorker.findFirst({ where: { provider: PROVIDER, candidateId: link.candidateId } });
  if (!pw) return null;
  return check.employeeOnboardUrl(pw.externalId);
}

// ---- runs ----
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** What the run page shows about Check: connection, each worker's setup, the preview and the status. */
export async function providerView(tdb: TenantDb, run: PayrollRun, candidateIds: string[]) {
  const conn = await getConnection(tdb);
  if (!conn) return null;
  // Until the company's setup is done in Check, look again each time (it changes over there, not here).
  const companyStatus = conn.onboardStatus === 'blocking' && run.status === 'APPROVED' ? (await refreshCompany(tdb, conn)).status : conn.onboardStatus;
  const workers = await tdb.payrollWorker.findMany({ where: { provider: PROVIDER, candidateId: { in: candidateIds } } });
  return {
    connected: true as const, companyName: conn.companyName, companyReady: companyStatus !== 'blocking', live: check.checkLive(),
    payrollId: run.providerPayrollId, status: run.providerStatus, statusLabel: run.providerStatus ? check.PROVIDER_STATUS[run.providerStatus] ?? run.providerStatus : null,
    totals: (run.providerTotals as check.ProviderTotals | null) ?? null, sentAt: run.providerSentAt?.toISOString() ?? null, error: run.providerError,
    workers: Object.fromEntries(workers.map((w) => [w.candidateId, { status: w.onboardStatus, missing: w.missing.map(check.stepLabel) }])),
  };
}

/**
 * Sends an approved run to Check as a draft payroll and stores Check's preview (taxes, net pay, cash needed).
 * Sending again replaces the draft. Workers who haven't finished their setup in Check hold the run back.
 */
export async function sendRun(tdb: TenantDb, org: Organization, user: Actor, runId: string) {
  const conn = await needConnection(tdb);
  const loaded = await loadRun(tdb, runId);
  const { run, items } = loaded;
  if (run.status !== 'APPROVED') throw new HttpError(409, 'Approve the run here first, then send it to Check.');
  if (run.providerStatus && check.LOCKED.has(run.providerStatus)) throw new HttpError(409, 'This run was already approved in Check.');
  if (!items.length) throw new HttpError(400, 'There are no hours in this run.');
  if (conn.onboardStatus === 'blocking') {
    const co = await refreshCompany(tdb, conn);
    if (co.status === 'blocking') throw new HttpError(409, `Finish your company’s setup in Check first${co.missing.length ? ` (still needed: ${co.missing.join(', ')})` : ''}.`);
  }
  // Workers, with a start date of their first week in this run.
  const firstWeek = new Map<string, string>();
  for (const i of items) if (!firstWeek.has(i.candidateId) || i.weekEnding < firstWeek.get(i.candidateId)!) firstWeek.set(i.candidateId, i.weekEnding);
  const people = await tdb.candidate.findMany({ where: { id: { in: [...firstWeek.keys()] } }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } });
  const workers = await ensureWorkers(tdb, conn, people.map((p) => ({ candidateId: p.id, name: p.name, email: p.email, startDate: ymd(new Date(Date.parse(`${firstWeek.get(p.id)}T00:00:00Z`) - 6 * 864e5)) })));
  const notReady = people.filter((p) => workers.get(p.id)?.onboardStatus === 'blocking');
  if (notReady.length) {
    return { ok: false as const, notReady: notReady.map((p) => ({ candidateId: p.id, name: p.name, missing: (workers.get(p.id)?.missing ?? []).map(check.stepLabel) })) };
  }
  await syncDeductions(tdb, new Map([...workers].map(([id, w]) => [id, w.externalId])));
  const built = check.payrollItems(items, new Map([...workers].map(([id, w]) => [id, w.externalId])), conn.workplaceId);
  if (built.problems.length) throw new HttpError(400, built.problems.join(' '));
  if (run.providerPayrollId && run.providerStatus === 'draft') await check.deletePayroll(run.providerPayrollId).catch(() => null);
  try {
    const p = await check.createPayroll(conn.companyId, loaded.meta, built.items);
    const preview = await check.previewPayroll(p.id);
    await tdb.payrollRun.updateMany({ where: { id: run.id }, data: { providerPayrollId: p.id, providerStatus: p.status || 'draft', providerTotals: preview as never, providerSentAt: new Date(), providerError: null } });
    const ours = totals(items).gross;
    await audit(org.id, user, 'payroll.send', `Sent payroll run ${run.number} to Check`, { targetType: 'payrollRun', targetId: run.id });
    return { ok: true as const, totals: preview, grossMatches: Math.abs(preview.gross - ours) <= 1 };
  } catch (e) {
    await tdb.payrollRun.updateMany({ where: { id: run.id }, data: { providerError: e instanceof Error ? e.message : 'Check didn’t accept the payroll.' } });
    throw e;
  }
}

/**
 * Sends recurring deductions to Check for these workers: new ones are created on the employee, ended ones are ended
 * there too. Check then takes them on every payroll, so they aren't also put on the payroll items.
 */
export async function syncDeductions(tdb: TenantDb, employees: Map<string, string>) {
  const rows = await tdb.payDeduction.findMany({ where: { candidateId: { in: [...employees.keys()] } }, orderBy: { createdAt: 'asc' } });
  for (const d of rows) {
    const t = DEDUCTION_TYPES[d.type as DeductionType] ?? DEDUCTION_TYPES.OTHER;
    const end = d.endDate ? ymd(d.endDate) : null;
    if (!d.providerId) {
      const made = await check.createDeduction({
        employee: employees.get(d.candidateId)!, checkBenefit: t.check, label: d.label, amountType: d.amountType as 'FIXED' | 'PERCENT', amount: Number(d.amount),
        annualLimit: d.annualLimit === null ? null : Number(d.annualLimit), employerAmount: d.employerAmount === null ? null : Number(d.employerAmount), startDate: ymd(d.startDate), endDate: end,
      });
      await tdb.payDeduction.updateMany({ where: { id: d.id }, data: { providerId: `${made.kind}:${made.id}${end ? `|${end}` : ''}`, providerSyncedAt: new Date() } });
    } else {
      // providerId is "kind:id", plus "|end" once an end date was sent, so an end is sent once (again if it changes).
      const [ref, sentEnd = null] = d.providerId.split('|');
      if (end && end !== sentEnd) {
        const [kind, id] = ref.split(':') as ['benefit' | 'post_tax', string];
        await check.endDeduction(id, kind, end);
        await tdb.payDeduction.updateMany({ where: { id: d.id }, data: { providerId: `${ref}|${end}`, providerSyncedAt: new Date() } });
      }
    }
  }
}

/** Approves the draft payroll in Check. After this Check debits the firm's account and pays workers on the pay date. */
export async function approveInProvider(tdb: TenantDb, org: Organization, user: Actor, runId: string) {
  const run = await tdb.payrollRun.findFirst({ where: { id: runId } });
  if (!run) throw new HttpError(404, 'That payroll run was deleted.');
  if (run.status !== 'APPROVED' || !run.providerPayrollId || run.providerStatus !== 'draft') throw new HttpError(409, 'Send the run to Check and review the taxes first.');
  const status = await check.approvePayroll(run.providerPayrollId);
  await tdb.payrollRun.updateMany({ where: { id: run.id }, data: { providerStatus: status || 'pending', providerError: null } });
  const t = run.providerTotals as check.ProviderTotals | null;
  const summary = `Approved payroll run ${run.number} in Check${t ? `: $${(t.net / 100).toFixed(2)} net pay, $${(t.cashNeeded / 100).toFixed(2)} to be debited` : ''}`;
  await logActivity(org.id, summary, user.id);
  await audit(org.id, user, 'payroll.providerApprove', summary, { targetType: 'payrollRun', targetId: run.id });
  return { status: status || 'pending' };
}

/** Re-reads a sent payroll from Check; once Check has paid it, the run and its timesheets are marked paid. */
export async function refreshRun(orgId: string, runId: string) {
  const tdb = tenantDb(orgId);
  const run = await tdb.payrollRun.findFirst({ where: { id: runId } });
  if (!run?.providerPayrollId) return null;
  const p = await check.getPayroll(run.providerPayrollId);
  const data: Record<string, unknown> = { providerStatus: p.status };
  if (p.status === 'failed') data.providerError = 'Check couldn’t pay this run. Open Check to see why.';
  if (p.status === 'paid' && run.status === 'APPROVED') {
    const now = new Date();
    await tdb.$transaction(async (tx) => {
      await tx.payrollRun.updateMany({ where: { id: run.id, status: 'APPROVED' }, data: { ...data, status: 'PAID', paidAt: now } });
      await tx.timesheet.updateMany({ where: { payrollRunId: run.id, status: 'APPROVED' }, data: { status: 'PAID', paidAt: now } });
    });
    await logActivity(orgId, `Check paid payroll run ${run.number}`);
  } else await tdb.payrollRun.updateMany({ where: { id: run.id }, data });
  return p.status;
}

/**
 * Before a run is reopened or voided here: a draft in Check is deleted with it; one approved in Check has to be
 * cancelled in Check first, because the money may already be moving.
 */
export async function releaseProviderPayroll(tdb: TenantDb, run: PayrollRun) {
  if (!run.providerPayrollId) return;
  if (run.providerStatus && check.LOCKED.has(run.providerStatus)) throw new HttpError(409, 'This run was approved in Check. Cancel it in Check first, then change it here.');
  await check.deletePayroll(run.providerPayrollId).catch((e) => { if (!(e instanceof HttpError && e.status === 404)) throw e; });
  await tdb.payrollRun.updateMany({ where: { id: run.id }, data: { providerPayrollId: null, providerStatus: null, providerTotals: Prisma.DbNull, providerSentAt: null, providerError: null } });
}

/** Check webhook: re-read whatever it points at (a payroll or an employee), using our own records to find the firm. */
export async function applyWebhook(body: unknown) {
  const d = (body as { data?: { id?: string; object?: string; payroll?: string; employee?: string } })?.data ?? {};
  const id = typeof d.id === 'string' ? d.id : '';
  const payrollId = d.payroll ?? (id.startsWith('pay_') ? id : null), employeeId = d.employee ?? (id.startsWith('emp_') ? id : null);
  if (payrollId) {
    const run = await db.payrollRun.findFirst({ where: { providerPayrollId: payrollId }, select: { id: true, organizationId: true } });
    return run ? !!(await refreshRun(run.organizationId, run.id)) : false;
  }
  if (employeeId) {
    const pw = await db.payrollWorker.findFirst({ where: { provider: PROVIDER, externalId: employeeId } });
    if (!pw) return false;
    const e = await check.getEmployee(employeeId);
    await tenantDb(pw.organizationId).payrollWorker.updateMany({ where: { id: pw.id }, data: { onboardStatus: e.onboard, missing: e.missing, checkedAt: new Date() } });
    return true;
  }
  return false;
}
