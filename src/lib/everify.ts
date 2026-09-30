// E-Verify case tracking. Pure functions: deadlines and statuses.
//
// Employers enrolled in E-Verify must create a case no later than the third business day after the employee
// starts work for pay (after the Form I-9 is complete). Submitting cases straight to DHS needs enrollment as an
// E-Verify Web Services employer agent, so cases are created in E-Verify itself and tracked here.

export const STATUSES = {
  to_create: { label: 'Case to create', open: true },
  open: { label: 'Case open', open: true },
  tnc: { label: 'Tentative nonconfirmation', open: true },
  referred: { label: 'Referred (employee contesting)', open: true },
  authorized: { label: 'Employment authorized', open: false },
  final_nonconfirmation: { label: 'Final nonconfirmation', open: false },
  closed: { label: 'Closed', open: false },
} as const;
export type EvStatus = keyof typeof STATUSES;
export const isStatus = (s: string): s is EvStatus => s in STATUSES;

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** The Nth business day after a date (Mon–Fri; federal holidays aren't counted out, so this errs early). */
export function businessDaysAfter(start: string, n: number) {
  const d = day(start);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return ymd(d);
}

/** Case-creation deadline: third business day after the first day of work. */
export const createBy = (startDate: string) => businessDaysAfter(startDate, 3);

/** An employee has 8 federal government working days to contact DHS/SSA after a referred TNC (tracked as a reminder). */
export const contactBy = (referredOn: string) => businessDaysAfter(referredOn, 8);

export type Urgency = 'overdue' | 'due' | 'ok' | 'done';
export function urgency(c: { status: string; dueDate: string }, today: string): Urgency {
  if (!isStatus(c.status) || !STATUSES[c.status].open) return 'done';
  if (c.status !== 'to_create') return 'ok'; // the case exists; the deadline was about creating it
  if (c.dueDate < today) return 'overdue';
  return c.dueDate <= businessDaysAfter(today, 1) ? 'due' : 'ok';
}
