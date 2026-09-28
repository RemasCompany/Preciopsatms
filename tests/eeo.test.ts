import { describe, expect, it } from 'vitest';
import type { Stage } from '@prisma/client';
import { adverseImpact, bestStageByCandidate } from '@/lib/eeo';

// Builds N candidates in a group, `hired` of whom reached PLACED, `interviewed` (incl. hired) reached INTERVIEW.
function group(prefix: string, gender: string, n: number, hired: number, interviewed = hired) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`, gender,
    stage: (i < hired ? 'PLACED' : i < interviewed ? 'INTERVIEW' : 'APPLIED') as Stage,
  }));
}
function run(people: { id: string; gender: string | null; stage: Stage }[]) {
  const ids = people.map((p) => p.id);
  const selfIds = new Map(people.map((p) => [p.id, { gender: p.gender }]));
  const best = new Map(people.map((p) => [p.id, p.stage]));
  return adverseImpact(ids, selfIds, best, 'gender');
}

describe('four-fifths rule', () => {
  it('flags a group whose selection rate is below 80% of the top group', () => {
    // Men 48/80 = 60%, women 12/40 = 30% → ratio 0.5
    const rows = run([...group('m', 'Male', 80, 48), ...group('f', 'Female', 40, 12)]);
    const m = rows.find((r) => r.group === 'Male')!, f = rows.find((r) => r.group === 'Female')!;
    expect(m).toMatchObject({ applicants: 80, hired: 48, selectionRate: 0.6, impactRatio: 1, flagged: false });
    expect(f.selectionRate).toBeCloseTo(0.3);
    expect(f.impactRatio).toBeCloseTo(0.5);
    expect(f.flagged).toBe(true);
  });

  it('does not flag at exactly 80%', () => {
    // 50% vs 40% → ratio 0.8
    const f = run([...group('m', 'Male', 10, 5), ...group('f', 'Female', 10, 4)]).find((r) => r.group === 'Female')!;
    expect(f.impactRatio).toBeCloseTo(0.8);
    expect(f.flagged).toBe(false);
  });

  it('flags just under 80%', () => {
    // 50% vs 39% → 0.78
    const f = run([...group('m', 'Male', 100, 50), ...group('f', 'Female', 100, 39)]).find((r) => r.group === 'Female')!;
    expect(f.flagged).toBe(true);
  });

  it('excludes candidates who declined or did not answer', () => {
    const rows = run([
      ...group('m', 'Male', 2, 1),
      { id: 'd', gender: 'Decline to self-identify', stage: 'APPLIED' },
      { id: 'n', gender: null, stage: 'PLACED' },
    ]);
    expect(rows.map((r) => r.group)).toEqual(['Male']);
    expect(rows[0].applicants).toBe(2);
  });

  it('counts interviews separately from hires', () => {
    const [row] = run(group('m', 'Male', 10, 2, 6));
    expect(row).toMatchObject({ applicants: 10, interviewed: 6, hired: 2 });
  });

  it('returns null ratios when nobody was hired', () => {
    const rows = run([...group('m', 'Male', 5, 0), ...group('f', 'Female', 5, 0)]);
    expect(rows.every((r) => r.impactRatio === null && !r.flagged)).toBe(true);
  });

  it('uses each candidate’s furthest stage across applications', () => {
    const best = bestStageByCandidate([
      { candidateId: 'a', maxStage: 'SCREENED' }, { candidateId: 'a', maxStage: 'PLACED' }, { candidateId: 'a', maxStage: 'APPLIED' },
    ]);
    expect(best.get('a')).toBe('PLACED');
  });
});
