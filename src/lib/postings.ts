// A ready-to-post job ad from the job's own details, used when nobody has written one, so every open job can go out to
// the careers page and job boards without a recruiter writing copy first. Pure (tested).
const TYPE: Record<string, string> = { CONTRACT: 'contract', CONTRACT_TO_HIRE: 'contract-to-hire', DIRECT_HIRE: 'full-time, direct hire', TEMP: 'temporary', PER_DIEM: 'per diem', FULL_TIME: 'full-time', PART_TIME: 'part-time', SEASONAL: 'seasonal' };

type Job = { title: string; location: string | null; remote: boolean; type: string; payRate: unknown; skills: string[]; requiredCerts?: string[]; startDate: Date | null; sector?: string | null; openings?: number };
type Org = { name: string; shortName: string | null; showPayOnCareers: boolean };

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function autoPosting(j: Job, org: Org) {
  const company = org.shortName ?? org.name, kind = TYPE[j.type] ?? 'open';
  const where = j.remote ? 'remote' : j.location ? `in ${j.location}` : '';
  const pay = org.showPayOnCareers && Number(j.payRate) > 0 ? `$${Number(j.payRate).toFixed(2).replace(/\.00$/, '')} an hour` : null;
  const lines = [
    `${company} is hiring ${j.openings && j.openings > 1 ? `${j.openings} people for` : 'a'} ${j.title} ${where ? `(${where}) ` : ''}— a ${kind} role${j.sector ? ` in ${j.sector.toLowerCase()}` : ''}.`,
    pay ? `Pay: ${pay}.` : '',
    j.startDate ? `Start date: ${j.startDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}.` : '',
    j.skills.length ? `What you’ll bring: ${list(j.skills)}.` : '',
    j.requiredCerts?.length ? `Required: ${list(j.requiredCerts)} (current).` : '',
    'Apply in a couple of minutes — you can upload your resume and we’ll fill in the rest. We’ll be in touch if it’s a fit.',
    `${company} is an equal opportunity employer.`,
  ];
  return lines.filter(Boolean).join('\n\n');
}
