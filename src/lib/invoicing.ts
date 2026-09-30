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

export const PAYMENT_METHODS = { ach: 'ACH / bank transfer', check: 'Check', card: 'Card', wire: 'Wire', other: 'Other' } as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;
