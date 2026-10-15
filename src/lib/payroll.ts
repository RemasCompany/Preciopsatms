import { OT_MULTIPLIER } from './weeks';

/** Regular hours at the base rate plus overtime at 1.5x. Used for gross pay (pay rate) and billables (bill rate). */
export function hoursAmount(regularHours: number, overtimeHours: number, rate: number) {
  return regularHours * rate + overtimeHours * rate * OT_MULTIPLIER;
}

export const overtimeRate = (rate: number) => rate * OT_MULTIPLIER;
/** Paid time off: the regular rate, never overtime. */
export const leaveAmount = (hours: number, rate: number) => Math.round(hours * rate * 100) / 100;
