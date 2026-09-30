// Payroll run math, checks and provider export layouts. Pure functions (no DB) so they can be tested and shared with the UI.
// Money is handled in integer cents to avoid floating-point drift; the DB stores Decimal.
import { OT_MULTIPLIER } from './weeks';

export const FEDERAL_MIN_WAGE = 7.25;
export const WEEK_OT_THRESHOLD = 40;
export const FREQUENCIES = { WEEKLY: 'Weekly', BIWEEKLY: 'Every two weeks' } as const;
export type Frequency = keyof typeof FREQUENCIES;
export const ADJUSTMENTS = {
  BONUS: { label: 'Bonus', taxable: true, sign: 1 },
  OTHER_EARNING: { label: 'Other earning', taxable: true, sign: 1 },
  REIMBURSEMENT: { label: 'Reimbursement', taxable: false, sign: 1 },
  DEDUCTION: { label: 'Deduction', taxable: false, sign: -1 },
} as const;
export type AdjustmentKind = keyof typeof ADJUSTMENTS;

export const cents = (n: number) => Math.round(n * 100);
export const dollars = (c: number) => c / 100;

/** Wages for one timesheet: regular at the pay rate, overtime at 1.5×, each rounded to the cent. */
export function wages(regularHours: number, overtimeHours: number, payRate: number) {
  const regular = cents(regularHours * payRate), overtime = cents(overtimeHours * payRate * OT_MULTIPLIER);
  return { regular, overtime };
}

export type RunItem = {
  id: string; candidateId: string; workerName: string; payrollId: string | null; position: string; clientId: string | null; clientName: string | null;
  weekEnding: string; regularHours: number; overtimeHours: number; payRate: number; billRate: number; regularPay: number; overtimePay: number;
  adjustments: { id: string; kind: AdjustmentKind; description: string; amount: number }[];
};

/** Totals for a worker (or any set of items), in cents. */
export function totals(items: RunItem[]) {
  let hours = 0, regularHours = 0, overtimeHours = 0, wagesC = 0, extraTaxable = 0, reimbursements = 0, deductions = 0, billable = 0;
  for (const i of items) {
    regularHours += i.regularHours; overtimeHours += i.overtimeHours; hours += i.regularHours + i.overtimeHours;
    wagesC += cents(i.regularPay) + cents(i.overtimePay);
    billable += cents(i.regularHours * i.billRate) + cents(i.overtimeHours * i.billRate * OT_MULTIPLIER);
    for (const a of i.adjustments) {
      const c = cents(a.amount);
      if (a.kind === 'REIMBURSEMENT') reimbursements += c; else if (a.kind === 'DEDUCTION') deductions += c; else extraTaxable += c;
    }
  }
  const gross = wagesC + extraTaxable;
  return { hours, regularHours, overtimeHours, wages: wagesC, extraTaxable, gross, reimbursements, deductions, billable, margin: billable - wagesC };
}

export function byWorker(items: RunItem[]) {
  const m = new Map<string, RunItem[]>();
  for (const i of items) m.set(i.candidateId, [...(m.get(i.candidateId) ?? []), i]);
  return [...m.values()].sort((a, b) => a[0].workerName.localeCompare(b[0].workerName));
}

export type Check = { level: 'warn' | 'info'; text: string };

/**
 * Things to review before approving. Hours from every assignment in the same workweek count toward overtime,
 * because the agency is the employer of record.
 */
export function runChecks(items: RunItem[], left: { worker: string; weekEnding: string; status: string }[] = []): Check[] {
  const out: Check[] = [];
  for (const group of byWorker(items)) {
    const w = group[0].workerName;
    const weeks = new Map<string, RunItem[]>();
    for (const i of group) weeks.set(i.weekEnding, [...(weeks.get(i.weekEnding) ?? []), i]);
    for (const [week, list] of weeks) {
      const total = list.reduce((s, i) => s + i.regularHours + i.overtimeHours, 0);
      const regular = list.reduce((s, i) => s + i.regularHours, 0);
      if (regular > WEEK_OT_THRESHOLD + 0.001) out.push({ level: 'warn', text: `${w}: ${+regular.toFixed(2)} regular hours the week ending ${week}${list.length > 1 ? ' across assignments' : ''} — hours over ${WEEK_OT_THRESHOLD} must be paid as overtime. Fix the timesheet split before approving.` });
      else if (total > 80) out.push({ level: 'warn', text: `${w}: ${+total.toFixed(2)} hours the week ending ${week}. Check this isn’t a typo.` });
    }
    for (const i of group) {
      if (i.payRate <= 0) out.push({ level: 'warn', text: `${w}: no pay rate on ${i.position}.` });
      else if (i.payRate < FEDERAL_MIN_WAGE) out.push({ level: 'warn', text: `${w}: $${i.payRate.toFixed(2)}/hr on ${i.position} is below the federal minimum wage ($${FEDERAL_MIN_WAGE}). Many states require more.` });
      if (i.billRate > 0 && i.billRate < i.payRate) out.push({ level: 'warn', text: `${w}: bill rate ($${i.billRate.toFixed(2)}) is below pay rate ($${i.payRate.toFixed(2)}) on ${i.position}.` });
    }
    const t = totals(group);
    if (t.deductions > t.gross + t.reimbursements) out.push({ level: 'warn', text: `${w}: deductions are more than their pay for this run.` });
    if (!group[0].payrollId) out.push({ level: 'info', text: `${w} has no payroll employee ID. Add it on their candidate record so the import matches the right person.` });
  }
  for (const l of left) out.push({ level: 'info', text: `${l.worker}: the week ending ${l.weekEnding} is ${l.status === 'DRAFT' ? 'a draft timesheet' : 'not entered'} and isn’t in this run. Approve it and refresh the run to include it.` });
  return out;
}

// ---- exports ----
export const EXPORT_FORMATS = {
  csv: 'Standard CSV (any provider)',
  adp: 'ADP Workforce Now (paydata import)',
  paychex: 'Paychex Flex (payroll import)',
  quickbooks: 'QuickBooks Online Payroll (time import)',
  gusto: 'Gusto (hours and earnings import)',
} as const;
export type ExportFormat = keyof typeof EXPORT_FORMATS;
export const isExportFormat = (f: unknown): f is ExportFormat => typeof f === 'string' && f in EXPORT_FORMATS;

/** Earning codes used in exports. Most providers let you map these once during the first import. */
export const CODES = { REG: 'REG', OT: 'OT', BONUS: 'BON', OTHER_EARNING: 'OTH', REIMBURSEMENT: 'REIMB', DEDUCTION: 'DED' } as const;

const cell = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s; };
const csv = (rows: unknown[][]) => rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
const money = (c: number) => (c / 100).toFixed(2);
const hrs = (h: number) => h.toFixed(2);
const split = (name: string) => { const [first, ...rest] = name.trim().split(/\s+/); return { first: first ?? '', last: rest.join(' ') }; };
const adjSum = (items: RunItem[], kind: AdjustmentKind) => items.reduce((s, i) => s + i.adjustments.filter((a) => a.kind === kind).reduce((x, a) => x + cents(a.amount), 0), 0);
const adjNotes = (items: RunItem[]) => items.flatMap((i) => i.adjustments.map((a) => `${ADJUSTMENTS[a.kind].label}: ${a.description}`)).join('; ');

/** One file for the payroll provider. Rows are per worker and pay rate (hours at different rates stay separate). */
export function exportRun(format: ExportFormat, run: { number: string; periodStart: string; periodEnd: string; payDate: string }, items: RunItem[], opts: { companyCode?: string | null } = {}) {
  // Group by worker + pay rate: providers pay one rate per earning line.
  const lines: { key: string; items: RunItem[] }[] = [];
  for (const i of [...items].sort((a, b) => a.workerName.localeCompare(b.workerName) || a.payRate - b.payRate)) {
    const key = `${i.candidateId}|${i.payRate}`;
    const l = lines.find((x) => x.key === key);
    if (l) l.items.push(i); else lines.push({ key, items: [i] });
  }
  // Adjustments are per worker, so put them on the worker's first line only.
  const seen = new Set<string>();
  const rows = lines.map(({ items: li }) => {
    const i = li[0];
    const first = !seen.has(i.candidateId); seen.add(i.candidateId);
    const all = first ? items.filter((x) => x.candidateId === i.candidateId) : [];
    const t = totals(li);
    return {
      i, reg: t.regularHours, ot: t.overtimeHours, regPay: li.reduce((s, x) => s + cents(x.regularPay), 0), otPay: li.reduce((s, x) => s + cents(x.overtimePay), 0),
      bonus: adjSum(all, 'BONUS'), other: adjSum(all, 'OTHER_EARNING'), reimb: adjSum(all, 'REIMBURSEMENT'), ded: adjSum(all, 'DEDUCTION'),
      notes: adjNotes(all), positions: [...new Set(li.map((x) => x.position))].join(' / '), clients: [...new Set(li.map((x) => x.clientName).filter(Boolean))].join(' / '),
    };
  });
  const name = (r: (typeof rows)[number]) => split(r.i.workerName);
  switch (format) {
    case 'adp':
      // ADP Workforce Now "paydata" batch: one row per employee and rate, with extra earnings in the Earnings 3 columns.
      return csv([
        ['Co Code', 'Batch ID', 'File #', 'Employee Name', 'Rate 1', 'Reg Hours', 'O/T Hours', 'Earnings 3 Code', 'Earnings 3 Amount', 'Earnings 4 Code', 'Earnings 4 Amount', 'Earnings 5 Code', 'Earnings 5 Amount', 'Memo Code', 'Memo Amount'],
        ...rows.map((r) => [opts.companyCode ?? '', run.number, r.i.payrollId ?? '', name(r).last ? `${name(r).last}, ${name(r).first}` : name(r).first, r.i.payRate.toFixed(2), hrs(r.reg), hrs(r.ot),
          r.bonus ? CODES.BONUS : '', r.bonus ? money(r.bonus) : '', r.other ? CODES.OTHER_EARNING : '', r.other ? money(r.other) : '',
          r.reimb ? CODES.REIMBURSEMENT : '', r.reimb ? money(r.reimb) : '', r.ded ? CODES.DEDUCTION : '', r.ded ? money(r.ded) : '']),
      ]);
    case 'paychex': {
      // Paychex Flex: one row per worker per earning.
      const out: unknown[][] = [['Company ID', 'Worker ID', 'Last Name', 'First Name', 'Earning / Deduction Code', 'Hours', 'Rate', 'Amount', 'Check Date']];
      for (const r of rows) {
        const base = [opts.companyCode ?? '', r.i.payrollId ?? '', name(r).last, name(r).first];
        if (r.reg) out.push([...base, CODES.REG, hrs(r.reg), r.i.payRate.toFixed(2), money(r.regPay), run.payDate]);
        if (r.ot) out.push([...base, CODES.OT, hrs(r.ot), (r.i.payRate * 1.5).toFixed(4), money(r.otPay), run.payDate]);
        for (const [code, c] of [[CODES.BONUS, r.bonus], [CODES.OTHER_EARNING, r.other], [CODES.REIMBURSEMENT, r.reimb], [CODES.DEDUCTION, r.ded]] as const) if (c) out.push([...base, code, '', '', money(c), run.payDate]);
      }
      return csv(out);
    }
    case 'quickbooks': {
      // QuickBooks Online Payroll: employee, pay item, hours or amount.
      const out: unknown[][] = [['Employee', 'Employee ID', 'Pay Item', 'Hours', 'Rate', 'Amount', 'Pay Period Start', 'Pay Period End', 'Pay Date', 'Memo']];
      for (const r of rows) {
        const base = [r.i.workerName, r.i.payrollId ?? ''];
        if (r.reg) out.push([...base, 'Regular Pay', hrs(r.reg), r.i.payRate.toFixed(2), money(r.regPay), run.periodStart, run.periodEnd, run.payDate, r.positions]);
        if (r.ot) out.push([...base, 'Overtime Pay', hrs(r.ot), (r.i.payRate * 1.5).toFixed(4), money(r.otPay), run.periodStart, run.periodEnd, run.payDate, r.positions]);
        for (const [item, c] of [['Bonus', r.bonus], ['Other Earnings', r.other], ['Reimbursement', r.reimb], ['After-Tax Deduction', r.ded]] as const) if (c) out.push([...base, item, '', '', money(c), run.periodStart, run.periodEnd, run.payDate, r.notes]);
      }
      return csv(out);
    }
    case 'gusto':
      // Gusto hours import: one row per employee and rate.
      return csv([
        ['first_name', 'last_name', 'employee_id', 'regular_hours', 'overtime_hours', 'rate', 'bonus', 'other_earnings', 'reimbursement', 'post_tax_deduction', 'notes'],
        ...rows.map((r) => [name(r).first, name(r).last, r.i.payrollId ?? '', hrs(r.reg), hrs(r.ot), r.i.payRate.toFixed(2),
          r.bonus ? money(r.bonus) : '', r.other ? money(r.other) : '', r.reimb ? money(r.reimb) : '', r.ded ? money(r.ded) : '', r.notes]),
      ]);
    default:
      return csv([
        ['Run', 'Pay period start', 'Pay period end', 'Pay date', 'Employee ID', 'Employee name', 'First name', 'Last name', 'Position', 'Client', 'Regular hours', 'Overtime hours',
          'Regular rate', 'Overtime rate', 'Regular pay', 'Overtime pay', 'Bonus', 'Other earnings', 'Gross taxable pay', 'Reimbursements (non-taxable)', 'After-tax deductions', 'Notes'],
        ...rows.map((r) => [run.number, run.periodStart, run.periodEnd, run.payDate, r.i.payrollId ?? '', r.i.workerName, name(r).first, name(r).last, r.positions, r.clients,
          hrs(r.reg), hrs(r.ot), r.i.payRate.toFixed(2), (r.i.payRate * 1.5).toFixed(4), money(r.regPay), money(r.otPay), money(r.bonus), money(r.other),
          money(r.regPay + r.otPay + r.bonus + r.other), money(r.reimb), money(r.ded), r.notes]),
      ]);
  }
}
