import { describe, expect, it } from 'vitest';
import { aleTest, averageWeekly, DEFAULT_POLICY, employmentStart, evaluate, form1095Month, initialCycle, policyProblems, standardCycle, sundays, type Week } from '@/lib/aca';

/** Weekly hours from `from` (a Sunday) for `n` weeks. */
const run = (from: string, n: number, hours: number | ((i: number) => number)): Week[] =>
  Array.from({ length: n }, (_, i) => ({ weekEnding: new Date(Date.parse(`${from}T00:00:00Z`) + i * 7 * 864e5).toISOString().slice(0, 10), hours: typeof hours === 'number' ? hours : hours(i) }));

describe('ACA policy and periods', () => {
  it('checks the policy limits', () => {
    expect(policyProblems(DEFAULT_POLICY)).toEqual([]);
    expect(policyProblems({ measurementMonths: 12, adminMonths: 3, stabilityMonths: 6, startMonth: 13 })).toEqual([
      'The administrative period can be up to 2 months (the limit is 90 days).',
      'The stability period must be at least 12 months (no shorter than the measurement period, and at least 6), and at most 12.',
      'Choose the month measurement periods start.',
    ]);
    expect(policyProblems({ measurementMonths: 3, adminMonths: 0, stabilityMonths: 5, startMonth: 1 })[0]).toContain('at least 6 months');
  });

  it('lays out the standard cycle: measure Nov–Oct, administer Nov–Dec, stable Jan–Dec', () => {
    expect(standardCycle(DEFAULT_POLICY, 2024)).toEqual({
      measurement: { start: '2024-11-01', end: '2025-10-31' }, admin: { start: '2025-11-01', end: '2025-12-31' }, stability: { start: '2026-01-01', end: '2026-12-31' },
    });
  });

  it('starts a new employee’s measurement the next month and keeps it within the 13-month limit', () => {
    // Start Mar 10, 2025: measure Apr 2025 – Mar 2026; admin may run to the end of Apr 2026 (first full month after the anniversary).
    expect(initialCycle(DEFAULT_POLICY, '2025-03-10')).toEqual({
      measurement: { start: '2025-04-01', end: '2026-03-31' }, admin: { start: '2026-04-01', end: '2026-04-30' }, stability: { start: '2026-05-01', end: '2027-04-30' },
    });
    // Start on the 1st: the anniversary month itself is the limit, so only one admin month fits.
    expect(initialCycle(DEFAULT_POLICY, '2025-03-01').admin).toEqual({ start: '2026-03-01', end: '2026-03-31' });
  });

  it('averages over every week in the period, counting weeks off as zero', () => {
    const per = { start: '2025-01-01', end: '2025-01-31' };
    expect(sundays(per)).toEqual(['2025-01-05', '2025-01-12', '2025-01-19', '2025-01-26']);
    expect(averageWeekly([{ weekEnding: '2025-01-05', hours: 40 }, { weekEnding: '2025-01-19', hours: 40 }], per)).toEqual({ total: 80, weeks: 4, average: 20 });
  });

  it('treats a return after 13+ weeks off as a new employee', () => {
    const weeks = [...run('2024-01-07', 10, 40), ...run('2024-06-30', 4, 40)]; // last week Mar 10, back Jun 30 (15 weeks later)
    expect(employmentStart(weeks)).toBe('2024-06-24');
    expect(employmentStart([...run('2024-01-07', 10, 40), ...run('2024-05-26', 2, 40)])).toBe('2024-01-01'); // 10-week gap: same stretch
  });
});

describe('look-back evaluation', () => {
  it('an ongoing worker averaging 32 hours is full-time for the whole stability year', () => {
    const weeks = run('2023-10-01', 120, 32);
    const ev = evaluate(DEFAULT_POLICY, weeks, '2026-01-01', '2026-12-01', '2026-02-15');
    expect(ev.kind).toBe('ongoing');
    expect(Object.values(ev.months).every((m) => m.status === 'full_time')).toBe(true);
  });

  it('an ongoing worker averaging 28 is not full-time, and is flagged close in the running period', () => {
    const weeks = run('2023-10-01', 125, 28);
    const ev = evaluate(DEFAULT_POLICY, weeks, '2026-01-01', '2026-01-01', '2026-02-15');
    expect(ev.months['2026-01'].status).toBe('not_full_time');
    expect(ev.current).toMatchObject({ label: 'Standard measurement', period: { start: '2025-11-01', end: '2026-10-31' }, projected: 'close' });
  });

  it('a new worker is measuring for their first year, then full-time if they averaged 30+', () => {
    const weeks = run('2025-03-16', 70, 34); // started the week of Mar 10, 2025
    const ev = evaluate(DEFAULT_POLICY, weeks, '2025-02-01', '2026-06-01', '2026-07-01');
    expect(ev.kind).toBe('new');
    expect(ev.months['2025-03'].status).toBe('measuring');
    expect(ev.months['2026-04'].status).toBe('measuring'); // administrative period
    expect(ev.months['2026-05'].status).toBe('full_time');
    expect(ev.months['2026-05'].reason).toContain('initial measurement period 2025-04-01 to 2026-03-31');
    expect(ev.months['2025-02'].status).toBe('not_employed');
  });

  it('a new part-time worker isn’t full-time after measuring', () => {
    const ev = evaluate(DEFAULT_POLICY, run('2025-03-16', 70, 20), '2026-05-01', '2026-05-01', '2026-07-01');
    expect(ev.months['2026-05'].status).toBe('not_full_time');
  });

  it('a worker gone 13+ weeks is not employed for those months', () => {
    const ev = evaluate(DEFAULT_POLICY, run('2025-01-05', 10, 40), '2025-08-01', '2025-08-01', '2025-09-01');
    expect(ev.months['2025-08'].status).toBe('not_employed');
  });
});

describe('applicable large employer test', () => {
  it('adds full-time employees and full-time equivalents by month', () => {
    // 40 people at 35h/week (full-time), 30 at 15h/week (65 or 75 h/month → FTEs).
    const ft = Array.from({ length: 40 }, () => run('2025-01-05', 52, 35));
    const pt = Array.from({ length: 30 }, () => run('2025-01-05', 52, 15));
    const r = aleTest([...ft, ...pt], 2026);
    expect(r.months[0]).toEqual({ month: '2025-01', fullTime: 40, fte: 15 }); // Jan 2025 has 4 Sundays: 30 × 60h / 120
    expect(r).toMatchObject({ priorYear: 2025, ale: true });
    expect(aleTest(ft.slice(0, 30), 2026).ale).toBe(false);
  });
});

describe('Form 1095-C codes', () => {
  const offer = { coverageStart: '2026-01-01', coverageEnd: null, coverage: 'FAMILY' as const, minimumValue: true, employeeCost: 92.5, response: 'WAIVED' as const };
  it('suggests line 14, 15 and 16 codes', () => {
    expect(form1095Month('2026-03', 'full_time', [offer])).toEqual({ line14: '1E', line15: '92.50', line16: '' });
    expect(form1095Month('2026-03', 'full_time', [{ ...offer, response: 'ACCEPTED' }])).toEqual({ line14: '1E', line15: '92.50', line16: '2C' });
    expect(form1095Month('2026-03', 'full_time', [{ ...offer, coverage: 'EMPLOYEE', minimumValue: false }]).line14).toBe('1F');
    expect(form1095Month('2025-12', 'measuring', [offer])).toEqual({ line14: '1H', line15: '', line16: '2D' });
    expect(form1095Month('2025-12', 'not_full_time', [])).toEqual({ line14: '1H', line15: '', line16: '2B' });
    expect(form1095Month('2025-12', 'not_employed', [])).toEqual({ line14: '1H', line15: '', line16: '2A' });
  });
});
