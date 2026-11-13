// Invoice math and accounts-receivable aging. Pure functions (amounts in cents) so they're easy to test.
import { OT_MULTIPLIER } from './weeks';

export const toCents = (n: number | string | { toString(): string }) => Math.round(Number(n) * 100);
export const fromCents = (c: number) => (c / 100).toFixed(2);
export const usd = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** Dollars → whole cents, rounding half up without floating-point surprises (3 × 49.995 is 149.985, not 149.98499…). */
export const cents = (dollars: number) => Math.round(Number((dollars * 100).toPrecision(12)));

/** Regular hours at the bill rate plus overtime at 1.5x, rounded to the cent per line. */
export const lineCents = (reg: number, ot: number, rate: number) => cents(reg * rate) + cents(ot * rate * OT_MULTIPLIER);

/** "Net 30" → 30, "Due on receipt" → 0. Unknown wording falls back to 30. */
export function termsDays(terms: string) {
  if (/receipt/i.test(terms)) return 0;
  const n = parseInt(terms.replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 30;
}

const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 864e5;
export const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const daysOverdue = (dueDate: string, today: string) => Math.max(0, day(today) - day(dueDate));

export type InvoiceState = 'DRAFT' | 'SENT' | 'PARTIAL' | 'PAID' | 'VOID';
/** Status follows the money: paid in full → PAID, some paid → PARTIAL, else SENT once emailed (or DRAFT). */
export function statusFor(totalCents: number, paidCents: number, sent: boolean, voided = false): InvoiceState {
  if (voided) return 'VOID';
  if (totalCents > 0 && paidCents >= totalCents) return 'PAID';
  if (paidCents > 0) return 'PARTIAL';
  return sent ? 'SENT' : 'DRAFT';
}

export const BUCKETS = [
  { key: 'current', label: 'Current' },
  { key: 'd1', label: '1–30 days' },
  { key: 'd31', label: '31–60 days' },
  { key: 'd61', label: '61–90 days' },
  { key: 'd90', label: '90+ days' },
] as const;
export type BucketKey = (typeof BUCKETS)[number]['key'];
export const bucketFor = (overdue: number): BucketKey => (overdue <= 0 ? 'current' : overdue <= 30 ? 'd1' : overdue <= 60 ? 'd31' : overdue <= 90 ? 'd61' : 'd90');

type Open = { clientId: string; client: string; dueDate: string; balanceCents: number };
type Row = Record<BucketKey, number> & { clientId: string; client: string; total: number; oldest: number };
const empty = (): Record<BucketKey, number> => ({ current: 0, d1: 0, d31: 0, d61: 0, d90: 0 });

/** AR aging by client (open balances only), biggest balance first, plus the totals row. */
export function aging(invoices: Open[], today: string) {
  const byClient = new Map<string, Row>();
  const totals = { ...empty(), total: 0 };
  for (const inv of invoices) {
    if (inv.balanceCents <= 0) continue;
    const od = daysOverdue(inv.dueDate, today), b = bucketFor(od);
    const r = byClient.get(inv.clientId) ?? { ...empty(), clientId: inv.clientId, client: inv.client, total: 0, oldest: 0 };
    r[b] += inv.balanceCents; r.total += inv.balanceCents; r.oldest = Math.max(r.oldest, od);
    byClient.set(inv.clientId, r);
    totals[b] += inv.balanceCents; totals.total += inv.balanceCents;
  }
  return { rows: [...byClient.values()].sort((a, b) => b.total - a.total || a.client.localeCompare(b.client)), totals };
}

/** Days sales outstanding over a window: open AR ÷ (billed in the window ÷ days). Null when nothing was billed. */
export function dso(openCents: number, billedCents: number, days = 90) {
  return billedCents > 0 ? Math.round(openCents / (billedCents / days)) : null;
}

export const PAYMENT_METHODS = { ach: 'ACH / bank transfer', check: 'Check', card: 'Card', wire: 'Wire', vms_fee: 'VMS fee withheld', other: 'Other' } as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;

/** Lines added by hand on top of the hours: reimbursed expenses, fees, and discounts or credits. */
/** Lines that are labor: the hours, and the premiums (night, weekend, on-call…) billed with them. They come from timesheets, not by hand. */
export const LABOR_KINDS = ['hours', 'premium'];
export const isLabor = (kind: string | null | undefined) => LABOR_KINDS.includes(kind ?? 'hours');
export const ITEM_KINDS = { expense: 'Expense / reimbursement', fee: 'Fee or charge', discount: 'Discount or credit' } as const;
export type ItemKind = keyof typeof ITEM_KINDS;
/** Quantity × rate to the cent; discounts always come off the total. */
export const itemCents = (kind: ItemKind, qty: number, rate: number) => { const c = cents(qty * rate); return kind === 'discount' ? -Math.abs(c) : c; };

/** Subtotal (labor plus items), sales tax on the subtotal, and the total — all in cents. */
export function invoiceTotals(laborCents: number, itemCentsList: number[], taxRatePct: number) {
  const items = itemCentsList.reduce((s, c) => s + c, 0);
  const subtotal = laborCents + items;
  const tax = taxRatePct > 0 ? cents((subtotal / 100) * (taxRatePct / 100)) : 0;
  return { labor: laborCents, extras: itemCentsList.filter((c) => c > 0).reduce((s, c) => s + c, 0), discounts: -itemCentsList.filter((c) => c < 0).reduce((s, c) => s + c, 0), subtotal, tax, total: subtotal + tax };
}

/** Card networks cap surcharges at 3%; bank transfers (ACH) never carry a fee. */
export const MAX_CARD_FEE_PCT = 3;
/** The fee added to a card payment of `balanceCents`, rounded to the cent. Zero when the firm absorbs it. */
export const cardFeeCents = (balanceCents: number, pct: number) =>
  balanceCents > 0 && pct > 0 ? cents((balanceCents / 100) * (Math.min(pct, MAX_CARD_FEE_PCT) / 100)) : 0;

/**
 * Reminder schedule, in days from the due date: 3 days before, on the day, then 7, 14, 30, 60 and 90 days past due.
 * Stops after the last step or once the invoice is paid.
 */
export const REMINDER_DAYS = [-3, 0, 7, 14, 30, 60, 90] as const;
/** At least this many days between two reminders for one invoice, even if steps were missed. */
export const REMINDER_GAP_DAYS = 3;

/**
 * Which reminder step (index into REMINDER_DAYS) is due today, or null. An invoice emailed late jumps to the latest step
 * that applies instead of sending every missed one.
 */
export function reminderStep(dueDate: string, today: string, sentSteps: number, lastReminder: string | null, emailedOn: string) {
  const rel = day(today) - day(dueDate);
  let step = -1;
  REMINDER_DAYS.forEach((d, i) => { if (rel >= d) step = i; });
  if (step < sentSteps || step < 0) return null;
  // Nothing on the day the invoice itself went out, nor too soon after the last reminder.
  if (day(today) - day(emailedOn) < 1) return null;
  if (lastReminder && day(today) - day(lastReminder) < REMINDER_GAP_DAYS) return null;
  return step;
}
