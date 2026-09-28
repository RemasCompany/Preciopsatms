import type { Stage } from '@prisma/client';

/** Board columns, left to right. APPLIED holds careers-page applicants; the rest mirror the prototype. */
export const BOARD_STAGES: Stage[] = ['APPLIED', 'SOURCED', 'SCREENED', 'SUBMITTED', 'INTERVIEW', 'OFFER', 'PLACED', 'REJECTED'];
/** Stages a recruiter can start someone at when adding them to a pipeline by hand. */
export const START_STAGES: Stage[] = ['SOURCED', 'SCREENED', 'SUBMITTED', 'INTERVIEW'];

export const stageLabel = (s: Stage) => s[0] + s.slice(1).toLowerCase();

export const REJECTION_REASONS = [
  'Did not meet minimum qualifications', 'Less qualified than selected candidate', 'Rate or pay mismatch', 'Withdrew / not interested',
  'No-show or unresponsive', 'Failed background or drug screen', 'Client declined', 'Position filled or cancelled', 'Other',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];
