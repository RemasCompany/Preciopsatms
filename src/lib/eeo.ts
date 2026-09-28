import type { Stage } from '@prisma/client';

export const STAGE_ORDER: Stage[] = ['APPLIED', 'SOURCED', 'SCREENED', 'SUBMITTED', 'INTERVIEW', 'OFFER', 'PLACED'];
export const reached = (s: Stage, min: Stage) => STAGE_ORDER.indexOf(s) >= STAGE_ORDER.indexOf(min);
export const EEO_DIMENSIONS = ['gender', 'race', 'veteran', 'disability'] as const;
export type EeoDimension = (typeof EEO_DIMENSIONS)[number];
export const FOUR_FIFTHS = 0.8;

/** Furthest stage each candidate reached across all their applications. */
export function bestStageByCandidate(apps: { candidateId: string; maxStage: Stage }[]) {
  const best = new Map<string, Stage>();
  for (const a of apps) {
    const cur = best.get(a.candidateId);
    if (!cur || STAGE_ORDER.indexOf(a.maxStage) > STAGE_ORDER.indexOf(cur)) best.set(a.candidateId, a.maxStage);
  }
  return best;
}

/**
 * Applicant flow for one dimension with the four-fifths rule: each group's selection (hire) rate divided by
 * the highest group's rate; below 0.80 is flagged. Candidates without an answer or who declined are excluded.
 */
export function adverseImpact(
  candidateIds: string[],
  selfIds: Map<string, Partial<Record<EeoDimension, string | null>>>,
  best: Map<string, Stage>,
  dim: EeoDimension,
) {
  const groups = new Map<string, { applicants: number; interviewed: number; hired: number }>();
  for (const c of candidateIds) {
    const g = selfIds.get(c)?.[dim]; if (!g || g === 'Decline to self-identify') continue;
    const s = best.get(c); if (!s) continue;
    const row = groups.get(g) ?? { applicants: 0, interviewed: 0, hired: 0 };
    row.applicants++; if (reached(s, 'INTERVIEW')) row.interviewed++; if (reached(s, 'PLACED')) row.hired++; groups.set(g, row);
  }
  const rows = [...groups].map(([group, r]) => ({ group, ...r, selectionRate: r.applicants ? r.hired / r.applicants : 0 }));
  const top = Math.max(0, ...rows.map((r) => r.selectionRate));
  return rows.map((r) => ({ ...r, impactRatio: top ? r.selectionRate / top : null, flagged: top ? r.selectionRate / top < FOUR_FIFTHS : false }));
}
