import { describe, expect, it } from 'vitest';
import { addDays, capacity, forecast, hiringPlan, lastYearWeek, monthly, weekOf, weekly, yearToDate, type WeekRow } from '@/lib/planning';

// Five people, 40h a week all of last year; this year 10% more hours, and a December peak last year.
function history() {
  const rows: WeekRow[] = [];
  for (let w = '2025-01-05'; w <= '2026-10-11'; w = addDays(w, 7)) {
    const ly = w < '2026-01-01', dec = w.slice(5, 7) === '12';
    for (let p = 0; p < 5; p++) {
      const h = (ly ? 40 : 44) * (dec ? 1.5 : 1);
      rows.push({ week: w, segment: p < 3 ? 'Warehouse' : 'Office', worker: `p${p}`, hours: h, overtime: Math.max(0, h - 40), costCents: Math.round(h * 2000), billCents: 0 });
    }
  }
  return rows;
}

describe('labor planning', () => {
  it('finds weeks and last year’s same week', () => {
    expect([weekOf('2026-10-14'), weekOf('2026-10-18'), lastYearWeek('2026-10-18')]).toEqual(['2026-10-18', '2026-10-18', '2025-10-19']);
  });

  it('compares this year with last, month by month and year to date', () => {
    const rows = history();
    const m = monthly(rows, 2026, '2026-10-11');
    expect(m[0].thisYear!.hours / m[0].lastYear.hours).toBeCloseTo(1.1, 2);
    expect([m[10].thisYear, m[11].lastYear.overtime > 0]).toEqual([null, true]);
    // October is partial (through the 11th): compared with the same two weeks last year.
    expect([m[9].partial, m[9].thisYear!.hours, m[9].lastYear.hours]).toEqual([true, 440, 400]);
    const ytd = yearToDate(rows, 2026, '2026-10-11');
    expect(ytd.change.hours).toBe(10);
    expect([ytd.avgWorkers.thisYear, ytd.costPerHour.thisYear]).toEqual([5, 20]);
  });

  it('forecasts from last year’s same weeks scaled by this year’s trend, with the schedule as a floor', () => {
    const h = weekly(history());
    const f = forecast(h, '2026-10-11', { scheduled: new Map([['2026-10-18', 400]]) });
    expect(f).toHaveLength(13);
    expect(f[0]).toMatchObject({ week: '2026-10-18', model: 220, scheduled: 400, hours: 400, basis: 'last-year' });
    expect(f[1].hours).toBe(220); // 200 last year × 1.10
    const dec = f.find((w) => w.week === '2026-12-13')!;
    expect(dec.hours).toBe(330); // the December peak, grown 10%
    expect(forecast(new Map([['2026-10-11', 100]]), '2026-10-11')[0]).toMatchObject({ basis: 'recent', hours: 12.5 }); // no history: recent average
  });

  it('works out capacity and turnover, and the hires to cover the December peak', () => {
    const rows = history();
    // p4 left in July.
    const trimmed = rows.filter((r) => !(r.worker === 'p4' && r.week > '2026-07-01'));
    const c = capacity(trimmed, '2026-10-11');
    expect([c.active, c.hoursPerWorker, c.turnoverQuarterly]).toEqual([4, 44, 20]);
    const f = forecast(weekly(trimmed), '2026-10-11');
    const plan = hiringPlan(f, c, '2026-10-16', 21, 1);
    expect(plan.peak!.week.slice(0, 7)).toBe('2026-12');
    expect(plan.needed).toBeGreaterThanOrEqual(3);
    expect(plan.hires).toBe(plan.needed - 1); // an open requisition counts
    expect(plan.firstShortWeek! <= '2026-12-06').toBe(true);
    expect(plan.startBy).toBe(addDays(plan.firstShortWeek!, -27));
  });
});
