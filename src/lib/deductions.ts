// Recurring paycheck deductions: benefit premiums and retirement contributions taken every pay run. Pure (shared with
// the UI and tested). Wage garnishments aren't handled here: their legal limits vary by order and state, so they stay
// with the payroll provider.
import { cents } from './payroll-run';

export const DEDUCTION_TYPES = {
  MEDICAL: { label: 'Health insurance', pretax: true, code: 'MED', check: '125_medical' },
  DENTAL: { label: 'Dental insurance', pretax: true, code: 'DEN', check: '125_dental' },
  VISION: { label: 'Vision insurance', pretax: true, code: 'VIS', check: '125_vision' },
  HSA: { label: 'Health savings account (HSA)', pretax: true, code: 'HSA', check: 'hsa' },
  FSA: { label: 'Health care FSA', pretax: true, code: 'FSA', check: 'fsa_medical' },
  DEPENDENT_CARE: { label: 'Dependent care FSA', pretax: true, code: 'DCAP', check: 'fsa_dependent_care' },
  RETIREMENT_401K: { label: '401(k)', pretax: true, code: '401K', check: '401k' },
  ROTH_401K: { label: 'Roth 401(k)', pretax: false, code: 'ROTH', check: 'roth_401k' },
  OTHER: { label: 'Other after-tax deduction', pretax: false, code: 'DED', check: null },
} as const;
export type DeductionType = keyof typeof DEDUCTION_TYPES;
export const isDeductionType = (t: string): t is DeductionType => t in DEDUCTION_TYPES;

export type Deduction = { amountType: 'FIXED' | 'PERCENT'; amount: number; annualLimit: number | null; startDate: string; endDate: string | null };

/** Whether the deduction applies to a run paid on `payDate`. */
export const activeOn = (d: Pick<Deduction, 'startDate' | 'endDate'>, payDate: string) => d.startDate <= payDate && (!d.endDate || d.endDate >= payDate);

/**
 * This run's deduction in cents: a fixed amount per run, or a percent of the worker's gross pay in the run; never more
 * than what's left of the annual limit (taken so far this calendar year, in other runs), and never more than the pay
 * still available after the deductions before it.
 */
export function deductionCents(d: Deduction, grossCents: number, takenThisYearCents: number, availableCents: number) {
  let c = d.amountType === 'PERCENT' ? cents((grossCents / 100) * (d.amount / 100)) : cents(d.amount);
  let note: string | null = null;
  if (d.annualLimit !== null) {
    const left = Math.max(0, cents(d.annualLimit) - takenThisYearCents);
    if (c > left) { c = left; note = left ? 'Reached this year’s limit.' : 'This year’s limit was already reached.'; }
  }
  if (c > availableCents) { c = Math.max(0, availableCents); note = 'Not enough pay this run to take all of it.'; }
  return { cents: c, note };
}

export const describe = (d: Deduction & { label: string }) =>
  `${d.label}: ${d.amountType === 'PERCENT' ? `${+d.amount}% of gross pay` : `$${d.amount.toFixed(2)}`} per pay run${d.annualLimit !== null ? `, up to $${d.annualLimit.toFixed(2)} a year` : ''}`;
