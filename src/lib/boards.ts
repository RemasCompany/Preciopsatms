// Job boards with their own feed URL. Kept separate from job-boards.ts so the browser bundle doesn't pull in crypto.
export type BoardGroup = 'General job sites' | 'Hourly & skilled trades' | 'Industry boards' | 'Professional network';
export type BoardInfo = {
  name: string; group: BoardGroup; format: 'indeed' | 'linkedin';
  /** What listing usually costs. Boards set and change this, so the UI says to confirm with them. */
  cost: 'Free listings' | 'Free + sponsored' | 'Paid account' | 'Varies';
  best: string; how: string;
};

export const BOARD_INFO = {
  indeed: { name: 'Indeed', group: 'General job sites', format: 'indeed', cost: 'Free + sponsored', best: 'The biggest reach for every kind of job; also shows on Glassdoor.', how: 'Submit the feed in Indeed’s employer XML program (or through your Indeed rep). Pair it with Indeed Apply below.' },
  ziprecruiter: { name: 'ZipRecruiter', group: 'General job sites', format: 'indeed', cost: 'Paid account', best: 'Fast applicant volume; pushes jobs to many partner sites.', how: 'Ask your ZipRecruiter rep to set up an XML feed for your account and give them this address.' },
  talent: { name: 'Talent.com', group: 'General job sites', format: 'indeed', cost: 'Free + sponsored', best: 'Large aggregator in the US and Canada.', how: 'Submit the feed through Talent.com’s employer/publisher page.' },
  jooble: { name: 'Jooble', group: 'General job sites', format: 'indeed', cost: 'Free + sponsored', best: 'International aggregator with strong US traffic.', how: 'Send the feed to Jooble from its “post your jobs” / partner page.' },
  careerjet: { name: 'Careerjet', group: 'General job sites', format: 'indeed', cost: 'Free listings', best: 'Global search engine for jobs.', how: 'Submit the feed through Careerjet’s “add your job feed” form.' },
  adzuna: { name: 'Adzuna', group: 'General job sites', format: 'indeed', cost: 'Free + sponsored', best: 'Aggregator with salary insights.', how: 'Contact Adzuna’s partnerships team with this feed address.' },
  jora: { name: 'Jora', group: 'General job sites', format: 'indeed', cost: 'Free listings', best: 'Aggregator owned by SEEK, strong for hourly work.', how: 'Submit the feed through Jora’s employer/feed page.' },
  lensa: { name: 'Lensa', group: 'General job sites', format: 'indeed', cost: 'Varies', best: 'Popular with nurses, drivers and tech workers.', how: 'Contact Lensa’s employer team with this feed address.' },
  whatjobs: { name: 'WhatJobs', group: 'General job sites', format: 'indeed', cost: 'Varies', best: 'Aggregator with a large email-alert audience.', how: 'Submit the feed through WhatJobs’ employer/feed page.' },
  jobrapido: { name: 'Jobrapido', group: 'General job sites', format: 'indeed', cost: 'Varies', best: 'Aggregator with mobile-first job alerts.', how: 'Contact Jobrapido’s partnerships team with this feed address.' },
  snagajob: { name: 'Snagajob', group: 'Hourly & skilled trades', format: 'indeed', cost: 'Paid account', best: 'Hourly, shift and part-time workers.', how: 'Ask your Snagajob account manager to set up an XML feed with this address.' },
  jobcase: { name: 'Jobcase', group: 'Hourly & skilled trades', format: 'indeed', cost: 'Varies', best: 'Warehouse, retail, driving and other hourly work.', how: 'Contact Jobcase’s employer team with this feed address.' },
  dice: { name: 'Dice', group: 'Industry boards', format: 'indeed', cost: 'Paid account', best: 'Technology and IT roles.', how: 'Ask your Dice account manager to import jobs from this feed.' },
  healthecareers: { name: 'Health eCareers', group: 'Industry boards', format: 'indeed', cost: 'Paid account', best: 'Nurses, allied health and physicians.', how: 'Ask your Health eCareers rep to set up a job feed with this address.' },
  hcareers: { name: 'Hcareers', group: 'Industry boards', format: 'indeed', cost: 'Paid account', best: 'Hospitality, hotels and restaurants.', how: 'Ask your Hcareers rep to set up a job feed with this address.' },
  clearancejobs: { name: 'ClearanceJobs', group: 'Industry boards', format: 'indeed', cost: 'Paid account', best: 'Roles that need a security clearance.', how: 'Ask your ClearanceJobs rep to import jobs from this feed.' },
  nexxt: { name: 'Nexxt', group: 'Industry boards', format: 'indeed', cost: 'Paid account', best: 'A network of niche and diversity job sites.', how: 'Ask your Nexxt rep to set up a job feed with this address.' },
  linkedin: { name: 'LinkedIn', group: 'Professional network', format: 'linkedin', cost: 'Varies', best: 'Professional, office and management roles.', how: 'LinkedIn takes job feeds through its job-posting partners and your LinkedIn rep (free Limited Listings or paid job slots). Add your LinkedIn company ID below, then give them this address.' },
} as const satisfies Record<string, BoardInfo>;

export type Board = keyof typeof BOARD_INFO;
/** Board names by key (kept for older callers). */
export const BOARDS = Object.fromEntries(Object.entries(BOARD_INFO).map(([k, v]) => [k, v.name])) as Record<Board, string>;
export const BOARD_GROUPS: BoardGroup[] = ['General job sites', 'Hourly & skilled trades', 'Industry boards', 'Professional network'];
export const isBoard = (b: string | null | undefined): b is Board => !!b && Object.prototype.hasOwnProperty.call(BOARD_INFO, b);
/** The boards a company had before boards could be turned on and off. */
export const ORIGINAL_BOARDS: Board[] = ['indeed', 'ziprecruiter', 'talent', 'jooble', 'careerjet', 'adzuna'];
/** Whether a job goes to this board: the board is on, and the job is posted everywhere or picked it. */
export const postsTo = (orgBoards: string[], jobBoards: string[], b: Board) => orgBoards.includes(b) && (!jobBoards.length || jobBoards.includes(b));
