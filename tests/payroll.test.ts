import { describe, expect, it } from 'vitest';
import { hoursAmount, overtimeRate } from '@/lib/payroll';
import { OT_MULTIPLIER, parseWeek, weekEnding, ymd } from '@/lib/weeks';

describe('payroll math', () => {
  it('pays overtime at 1.5x', () => {
    expect(OT_MULTIPLIER).toBe(1.5);
    expect(overtimeRate(20)).toBe(30);
  });

  it('computes gross pay for regular + overtime hours', () => {
    expect(hoursAmount(40, 0, 18.5)).toBe(740);
    expect(hoursAmount(40, 5, 18.5)).toBeCloseTo(740 + 5 * 27.75, 10); // 878.75
    expect(hoursAmount(0, 0, 25)).toBe(0);
  });

  it('computes billables and spread from the same hours', () => {
    const gross = hoursAmount(40, 4, 18.5), billable = hoursAmount(40, 4, 27);
    expect(billable).toBeCloseTo(1242, 10);
    expect(billable - gross).toBeCloseTo((27 - 18.5) * (40 + 4 * 1.5), 10);
  });
});

describe('weeks', () => {
  it('rolls any day forward to the Sunday week-ending', () => {
    expect(ymd(weekEnding(new Date(2026, 8, 23)))).toBe('2026-09-27'); // Wed → Sun
    expect(ymd(weekEnding(new Date(2026, 8, 27)))).toBe('2026-09-27'); // Sun stays
  });

  it('accepts a Sunday and rejects other days', () => {
    expect(ymd(parseWeek('2026-09-27'))).toBe('2026-09-27');
    expect(() => parseWeek('2026-09-28')).toThrow('Week ending must be a Sunday');
  });
});
