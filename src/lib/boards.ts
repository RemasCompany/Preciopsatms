// Job boards with their own feed URL. Kept separate from job-boards.ts so the browser bundle doesn't pull in crypto.
export const BOARDS = {
  indeed: 'Indeed', ziprecruiter: 'ZipRecruiter', talent: 'Talent.com', jooble: 'Jooble', careerjet: 'Careerjet', adzuna: 'Adzuna',
} as const;
export type Board = keyof typeof BOARDS;
export const isBoard = (b: string | null | undefined): b is Board => !!b && b in BOARDS;
