import type { Stage } from '@prisma/client';
import type { TenantDb } from './tenant';

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

export const DECLINE = 'Decline to self-identify';
/** Voluntary self-identification choices (EEO-1 / OFCCP categories), shown on the careers apply form. */
export const EEO_OPTIONS: Record<EeoDimension, string[]> = {
  gender: ['Female', 'Male', 'Non-binary / another gender', DECLINE],
  race: ['Hispanic or Latino', 'White', 'Black or African American', 'Asian', 'Native Hawaiian or Other Pacific Islander', 'American Indian or Alaska Native', 'Two or more races', DECLINE],
  veteran: ['Protected veteran', 'Not a protected veteran', DECLINE],
  disability: ['Yes, I have a disability', 'No, I do not have a disability', DECLINE],
};
export const EEO_LABELS: Record<EeoDimension, string> = { gender: 'Gender', race: 'Race / ethnicity', veteran: 'Veteran status', disability: 'Disability' };
/** Keeps an answer only if it is one of the offered choices. */
export const cleanEeoAnswer = (dim: EeoDimension, v: unknown) => (typeof v === 'string' && EEO_OPTIONS[dim].includes(v) ? v : undefined);

/** The full applicant-flow report. Admin-only callers; never join this into recruiter-facing data. */
export async function buildEeoReport(tdb: TenantDb, f: { jobId?: string; year?: number }) {
  const apps = await tdb.application.findMany({
    where: { ...(f.jobId ? { jobId: f.jobId } : {}), ...(f.year ? { createdAt: { gte: new Date(Date.UTC(f.year, 0, 1)), lt: new Date(Date.UTC(f.year + 1, 0, 1)) } } : {}) },
    select: { candidateId: true, maxStage: true, stage: true, rejectionReason: true },
  });
  const cands = [...new Set(apps.map((a) => a.candidateId))];
  const selfIds = await tdb.eeoSelfId.findMany({ where: { candidateId: { in: cands } } });
  const byCand = new Map(selfIds.map((s) => [s.candidateId, s]));
  const best = bestStageByCandidate(apps);
  const order = (dim: EeoDimension) => (a: { group: string }, b: { group: string }) => EEO_OPTIONS[dim].indexOf(a.group) - EEO_OPTIONS[dim].indexOf(b.group);
  const report = Object.fromEntries(EEO_DIMENSIONS.map((dim) => [dim, adverseImpact(cands, byCand, best, dim).sort(order(dim))])) as Record<EeoDimension, ReturnType<typeof adverseImpact>>;
  const answered = selfIds.filter((s) => EEO_DIMENSIONS.some((d) => s[d] && s[d] !== DECLINE)).length;
  const reasons: Record<string, number> = {};
  let missingReason = 0;
  for (const a of apps) if (a.stage === 'REJECTED') { if (a.rejectionReason) reasons[a.rejectionReason] = (reasons[a.rejectionReason] ?? 0) + 1; else missingReason++; }
  return {
    applicants: cands.length, selfIdRate: cands.length ? answered / cands.length : 0,
    hired: cands.filter((c) => best.get(c) && reached(best.get(c)!, 'PLACED')).length,
    missingReason, report, dispositionReasons: reasons,
    note: 'An impact ratio below 0.80 signals a step to review; it is not a legal finding. Review with employment counsel.',
  };
}
