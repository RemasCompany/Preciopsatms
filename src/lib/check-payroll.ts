import { createHmac, timingSafeEqual } from 'crypto';
import { HttpError } from './tenant';
import { ADJUSTMENTS, cents, dollars, type RunItem } from './payroll-run';

/**
 * Check (https://checkhq.com) embedded payroll: calculates and withholds taxes, pays workers by direct deposit or
 * paper check, and files with the agencies. Every call to Check is in this file so it can be checked against their
 * sandbox in one place (and another provider can sit behind the same functions).
 *
 * The platform holds one API key (CHECK_API_KEY). Each staffing firm is its own company in Check. CHECK_ENV=production
 * uses the live API; anything else the sandbox. Workers enter their own SSN, withholdings and bank account in Check's
 * hosted onboarding, so none of that ever passes through or is stored here.
 */
export const checkEnabled = () => !!process.env.CHECK_API_KEY?.trim();
export const checkLive = () => process.env.CHECK_ENV === 'production';
// CHECK_API_BASE points at a local stand-in for testing.
const base = () => process.env.CHECK_API_BASE?.trim() || (checkLive() ? 'https://api.checkhq.com' : 'https://sandbox.checkhq.com');

type Init = { method?: string; body?: object };
export async function check<T>(path: string, init: Init = {}): Promise<T> {
  if (!checkEnabled()) throw new HttpError(503, 'Payroll processing isn’t set up on this server yet (CHECK_API_KEY).');
  let r: Response;
  try {
    r = await fetch(`${base()}${path}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${process.env.CHECK_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: init.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new HttpError(502, 'We couldn’t reach Check. Try again in a minute.');
  }
  if (r.status === 204) return {} as T;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, `Check said: ${errorText(j) ?? `HTTP ${r.status}`}`);
  return j as T;
}

/** Check's errors look like {error: {message, input_errors: [{message, field_path}]}}. */
export function errorText(j: unknown): string | null {
  const e = (j as { error?: { message?: string; input_errors?: { message?: string; field_path?: string[] }[] } })?.error;
  if (!e) return null;
  const fields = (e.input_errors ?? []).map((i) => `${(i.field_path ?? []).join('.')}${i.field_path?.length ? ': ' : ''}${i.message ?? ''}`).filter(Boolean);
  return [e.message, ...fields].filter(Boolean).join(' — ') || null;
}

export type OnboardStatus = 'blocking' | 'needs_attention' | 'completed';
type Onboard = { status?: string; blocking_steps?: string[]; remaining_steps?: string[] };
const status = (o?: Onboard): OnboardStatus => (o?.status === 'completed' || o?.status === 'needs_attention' ? o.status : 'blocking');
const STEP_LABEL: Record<string, string> = {
  ssn: 'Social Security number', dob: 'date of birth', residence: 'home address', withholdings: 'tax withholdings (W-4)',
  payment_method: 'how they’re paid (bank account or paper check)', bank_account: 'bank account', filing_authorization: 'tax filing authorization',
  setup_parameters: 'state tax accounts', company_details: 'company details', ein: 'EIN',
};
export const stepLabel = (s: string) => STEP_LABEL[s] ?? s.replace(/_/g, ' ');

/** "Ana Lima Souza" → first "Ana", last "Lima Souza". Check needs both. */
export function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? { first_name: parts[0], last_name: parts.slice(1).join(' ') } : { first_name: parts[0] || 'Worker', last_name: parts[0] || 'Worker' };
}

export type Address = { line1: string; line2?: string | null; city: string; state: string; postal_code: string };

// ---- companies ----
export async function createCompany(c: { legalName: string; tradeName?: string | null; email?: string | null; address: Address }) {
  const co = await check<{ id: string; legal_name: string }>('/companies', {
    method: 'POST', body: { legal_name: c.legalName, trade_name: c.tradeName || undefined, email: c.email || undefined, address: c.address },
  });
  return { id: co.id, name: co.legal_name };
}
export async function getCompany(id: string) {
  const co = await check<{ id: string; legal_name: string; onboard?: Onboard }>(`/companies/${encodeURIComponent(id)}`);
  return { id: co.id, name: co.legal_name, onboard: status(co.onboard), missing: co.onboard?.blocking_steps ?? co.onboard?.remaining_steps ?? [] };
}
export async function createWorkplace(companyId: string, address: Address, name?: string) {
  const w = await check<{ id: string }>('/workplaces', { method: 'POST', body: { company: companyId, name: name || undefined, address } });
  return w.id;
}
export async function firstWorkplace(companyId: string) {
  const r = await check<{ results?: { id: string; active?: boolean }[] }>(`/workplaces?company=${encodeURIComponent(companyId)}`);
  return (r.results ?? []).find((w) => w.active !== false)?.id ?? null;
}
/** A one-time link to Check's hosted company setup (EIN, bank account, state tax accounts, filing authorization). */
export async function companyOnboardUrl(companyId: string) {
  return (await check<{ url: string }>(`/companies/${encodeURIComponent(companyId)}/components/onboard`, { method: 'POST', body: {} })).url;
}

// ---- employees ----
export async function createEmployee(companyId: string, workplaceId: string, w: { name: string; email: string | null; startDate: string | null }) {
  const e = await check<{ id: string; onboard?: Onboard }>('/employees', {
    method: 'POST', body: { company: companyId, ...splitName(w.name), email: w.email || undefined, start_date: w.startDate || undefined, workplaces: [workplaceId], primary_workplace: workplaceId },
  });
  return { id: e.id, onboard: status(e.onboard), missing: e.onboard?.blocking_steps ?? [] };
}
export async function getEmployee(id: string) {
  const e = await check<{ id: string; onboard?: Onboard }>(`/employees/${encodeURIComponent(id)}`);
  return { id: e.id, onboard: status(e.onboard), missing: e.onboard?.blocking_steps ?? e.onboard?.remaining_steps ?? [] };
}
/** A one-time link to Check's hosted employee setup (SSN, address, W-4, bank account). It expires quickly, so make one when it's opened. */
export async function employeeOnboardUrl(employeeId: string) {
  return (await check<{ url: string }>(`/employees/${encodeURIComponent(employeeId)}/components/onboard`, { method: 'POST', body: {} })).url;
}

// ---- payrolls ----
const amt = (c: number) => dollars(c).toFixed(2);

/**
 * The run's items as Check payroll items: one per worker, with an earning line per assignment and week
 * (regular, overtime at 1.5× as already computed, paid time off) plus bonuses and reimbursements. Hours and
 * amounts come from the run's snapshots, so Check pays exactly what was approved here.
 */
export function payrollItems(items: RunItem[], employeeIds: Map<string, string>, workplaceId: string) {
  const byWorker = new Map<string, RunItem[]>();
  for (const i of items) byWorker.set(i.candidateId, [...(byWorker.get(i.candidateId) ?? []), i]);
  const problems: string[] = [];
  const out = [...byWorker.entries()].map(([candidateId, list]) => {
    const employee = employeeIds.get(candidateId);
    if (!employee) problems.push(`${list[0].workerName} isn’t set up in Check yet.`);
    const earnings: { type: string; hours?: string; amount: string; description: string; workplace: string }[] = [];
    const reimbursements: { amount: string; description: string }[] = [];
    for (const i of list) {
      const what = `${i.position} · week ending ${i.weekEnding}`;
      if (i.regularHours) earnings.push({ type: 'hourly', hours: i.regularHours.toFixed(2), amount: amt(cents(i.regularPay)), description: what, workplace: workplaceId });
      if (i.overtimeHours) earnings.push({ type: 'overtime', hours: i.overtimeHours.toFixed(2), amount: amt(cents(i.overtimePay)), description: what, workplace: workplaceId });
      if (i.leaveHours) earnings.push({ type: 'pto', hours: i.leaveHours.toFixed(2), amount: amt(cents(i.leavePay ?? 0)), description: `Paid time off · week ending ${i.weekEnding}`, workplace: workplaceId });
      for (const a of i.adjustments) {
        const description = a.description || ADJUSTMENTS[a.kind].label;
        if (a.kind === 'REIMBURSEMENT') reimbursements.push({ amount: amt(cents(a.amount)), description });
        else if (a.kind === 'DEDUCTION') problems.push(`${i.workerName}: one-off deductions (“${description}”) aren’t sent to Check. Set it up as a post-tax deduction in Check, or remove it here.`);
        else earnings.push({ type: a.kind === 'BONUS' ? 'bonus' : 'taxable_other', amount: amt(cents(a.amount)), description, workplace: workplaceId });
      }
    }
    return { employee: employee ?? '', earnings, reimbursements };
  });
  return { items: out, problems: [...new Set(problems)] };
}

export type ProviderTotals = { gross: number; employeeTaxes: number; deductions: number; reimbursements: number; net: number; employerTaxes: number; cashNeeded: number; workers: { employee: string; net: number }[]; approvalDeadline: string | null };

const c = (v: unknown) => (v == null || v === '' ? 0 : cents(Number(v)));
/** Check's preview, in cents. */
export function readPreview(p: { totals?: Record<string, string>; items?: { employee: string; net_pay?: string }[]; approval_deadline?: string | null }): ProviderTotals {
  const t = p.totals ?? {};
  return {
    gross: c(t.employee_gross), employeeTaxes: c(t.employee_taxes), deductions: c(t.post_tax_deductions) + c(t.employee_benefits), reimbursements: c(t.employee_reimbursements),
    net: c(t.employee_net), employerTaxes: c(t.company_taxes), cashNeeded: c(t.liability ?? t.company_debit),
    workers: (p.items ?? []).map((i) => ({ employee: i.employee, net: c(i.net_pay) })), approvalDeadline: p.approval_deadline ?? null,
  };
}

export async function createPayroll(companyId: string, run: { periodStart: string; periodEnd: string; payDate: string }, items: ReturnType<typeof payrollItems>['items']) {
  const p = await check<{ id: string; status: string }>('/payrolls', {
    method: 'POST', body: { company: companyId, period_start: run.periodStart, period_end: run.periodEnd, payday: run.payDate, processing_period: 'four_day', type: 'regular', items },
  });
  return { id: p.id, status: p.status };
}
export const previewPayroll = async (id: string) => readPreview(await check(`/payrolls/${encodeURIComponent(id)}/preview`));
export const approvePayroll = async (id: string) => (await check<{ id: string; status: string }>(`/payrolls/${encodeURIComponent(id)}/approve`, { method: 'POST', body: {} })).status;
export const getPayroll = async (id: string) => {
  const p = await check<{ id: string; status: string; company: string }>(`/payrolls/${encodeURIComponent(id)}`);
  return { id: p.id, status: p.status, company: p.company };
};
export const deletePayroll = (id: string) => check(`/payrolls/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Statuses after approval, when it can no longer be changed here. */
export const LOCKED = new Set(['pending', 'processing', 'paid', 'partially_paid', 'failed']);
export const PROVIDER_STATUS: Record<string, string> = {
  draft: 'Sent to Check — review taxes and approve', pending: 'Approved in Check — waiting to be funded', processing: 'Check is paying workers',
  paid: 'Paid by Check', partially_paid: 'Partly paid — see Check', failed: 'Check couldn’t pay this run — see Check',
};

/**
 * Webhook signature: an HMAC-SHA256 of the raw body with CHECK_WEBHOOK_SECRET. We only use a webhook as a nudge to
 * re-read the payroll or employee from Check, so a forged body can't set a status by itself.
 */
export function verifyWebhook(raw: string, sig: string | null) {
  const secret = process.env.CHECK_WEBHOOK_SECRET?.trim();
  if (!secret || !sig) return false;
  const want = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex')), got = Buffer.from(sig.trim().replace(/^sha256=/, ''));
  return want.length === got.length && timingSafeEqual(want, got);
}
