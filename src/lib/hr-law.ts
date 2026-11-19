// HR compliance reference for the assistant's "HR compliance" mode: federal leave and accommodation law, and state
// paid family and medical leave programs. Plain-language summaries of the rules that rarely change, with the official
// source for each. Amounts that change every year (benefit caps, contribution rates, wage bases) are deliberately left
// out: the assistant looks those up on the official sites. This is general information, not legal advice.
// Reviewed: November 2026. Review at least every six months, and whenever a state program changes.

export const REVIEWED = '2026-11-19';

export type Entry = { title: string; summary: string[]; sources: string[] };

export const FEDERAL: Record<string, Entry> = {
  fmla: {
    title: 'Family and Medical Leave Act (FMLA)',
    summary: [
      'Covers private employers with 50 or more employees on the payroll in each of 20 or more workweeks in the current or previous calendar year (and all public agencies and schools).',
      'An employee is eligible after 12 months with the employer (need not be consecutive), at least 1,250 hours worked in the 12 months before leave starts, at a worksite with 50 or more employees within 75 miles.',
      'Eligible employees get up to 12 workweeks of unpaid, job-protected leave in a 12-month period for: the birth of a child and bonding (within 12 months), adoption or foster placement, caring for a spouse, child or parent with a serious health condition, their own serious health condition, and qualifying exigencies from a family member’s military deployment. Up to 26 workweeks in a single 12-month period to care for a covered servicemember with a serious injury or illness.',
      'Leave can be taken all at once, intermittently or on a reduced schedule when medically necessary (bonding leave intermittently only if the employer agrees). Travel to and from medical appointments counts as FMLA-protected time (DOL opinion letter FMLA2026-2).',
      'Group health coverage continues on the same terms during leave. On return the employee gets the same or an equivalent job with equivalent pay, benefits and terms.',
      'Employer may require (or the employee may choose) to use accrued paid leave at the same time, following the employer’s normal paid-leave rules. State paid leave benefits can run concurrently when both laws allow.',
      'Notices: post the FMLA poster (WHD 1420) and put the policy in the handbook. When an employee asks for leave or the employer learns leave may qualify, give the eligibility notice and rights-and-responsibilities notice within 5 business days, then the designation notice within 5 business days of having enough information. Employees give 30 days’ notice when leave is foreseeable, otherwise as soon as practicable.',
      'Certification: the employer may ask for medical certification (forms WH-380-E, WH-380-F) and must allow at least 15 calendar days to return it. Keep medical records confidential and separate from the personnel file. Keep FMLA records 3 years.',
      'It is unlawful to interfere with FMLA rights or to retaliate, including counting FMLA absences under an attendance policy.',
    ],
    sources: ['https://www.dol.gov/agencies/whd/fmla', 'https://www.dol.gov/agencies/whd/fmla/employer-guide', 'https://www.ecfr.gov/current/title-29/subtitle-B/chapter-V/subchapter-C/part-825'],
  },
  staffing_fmla: {
    title: 'FMLA for staffing agencies and their clients (joint employment)',
    summary: [
      'When a staffing agency places workers with a client, the agency is normally the primary employer and the client a secondary employer (29 CFR 825.106).',
      'The primary employer (the agency) gives the required notices, grants FMLA leave, maintains health benefits and restores the worker to their job.',
      'Placed workers count toward the 50-employee coverage test for both the agency and the client. The client must not interfere with or retaliate for the worker’s FMLA leave, and must accept the worker back from leave if it is still using a worker from the agency in that role.',
      'DOL proposed a new joint-employer rule for the FLSA and FMLA in April 2026; check its status before relying on joint-employer details.',
    ],
    sources: ['https://www.ecfr.gov/current/title-29/subtitle-B/chapter-V/subchapter-C/part-825/subpart-A/section-825.106', 'https://www.dol.gov/agencies/whd/fmla'],
  },
  pregnancy: {
    title: 'Pregnancy, childbirth and nursing (PWFA, PDA, PUMP Act)',
    summary: [
      'Pregnant Workers Fairness Act (PWFA), employers with 15 or more employees: provide reasonable accommodations for known limitations related to pregnancy, childbirth or related medical conditions unless it is an undue hardship (for example extra breaks, seating, light duty, schedule changes, time off to recover). Use an interactive process; don’t require leave if another accommodation would work; don’t demand more documentation than reasonable.',
      'In May 2025 a federal court vacated the parts of the EEOC’s PWFA rule that treated elective abortion as a condition to accommodate; the rest of the rule stands, and further court challenges are ongoing. Check eeoc.gov for current status.',
      'Pregnancy Discrimination Act (Title VII), 15 or more employees: no discrimination because of pregnancy, childbirth or related conditions in hiring, pay, assignments, leave or benefits.',
      'PUMP for Nursing Mothers Act (FLSA), almost all employers: reasonable break time and a private space, not a bathroom, shielded from view, to express breast milk for up to one year after the child’s birth. Employers with fewer than 50 employees can claim an exemption only if compliance would cause undue hardship.',
    ],
    sources: ['https://www.eeoc.gov/wysk/what-you-should-know-about-pregnant-workers-fairness-act', 'https://www.eeoc.gov/pregnancy-discrimination', 'https://www.dol.gov/agencies/whd/pump-at-work'],
  },
  ada: {
    title: 'Disability accommodation (ADA)',
    summary: [
      'Employers with 15 or more employees must provide reasonable accommodation to qualified employees and applicants with disabilities unless it causes undue hardship, through an interactive process.',
      'Leave can be a reasonable accommodation, including after FMLA leave runs out; avoid automatic termination when leave is exhausted without considering accommodation.',
      'Medical information must be kept confidential and stored separately from personnel files.',
    ],
    sources: ['https://www.eeoc.gov/laws/guidance/employer-best-practices-workers-caregiving-responsibilities', 'https://www.eeoc.gov/disability-discrimination-and-employment-decisions', 'https://askjan.org'],
  },
  military: {
    title: 'Military leave (USERRA)',
    summary: [
      'All employers, any size: employees who leave for military service (generally up to 5 years cumulative with one employer) have reemployment rights, with seniority and benefits as if continuously employed.',
      'Employees can choose to continue health coverage for up to 24 months. No discrimination or retaliation based on service.',
      'FMLA separately provides military caregiver (26 weeks) and qualifying exigency leave for eligible employees.',
    ],
    sources: ['https://www.dol.gov/agencies/vets/programs/userra'],
  },
  sick_leave: {
    title: 'Paid sick leave (state and local)',
    summary: [
      'There is no federal paid sick leave requirement for most private employers. Many states and cities require it, usually accrued at about 1 hour per 30 or 40 hours worked, with yearly caps that vary.',
      'States with statewide paid sick or paid leave laws include Alaska, Arizona, California, Colorado, Connecticut, Illinois, Maine, Maryland, Massachusetts, Michigan, Minnesota, Nebraska, New Jersey, New Mexico, New York, Oregon, Rhode Island, Vermont and Washington, plus Washington, DC. Rules on employer size, accrual, carryover and payout differ, and many cities add their own rules.',
      'Set up accrual in Preciops (Staff time off → policies) to match the strictest rule that applies where people work.',
    ],
    sources: ['https://www.dol.gov/agencies/whd/state/paid-sick-leave'],
  },
  posting_records: {
    title: 'Posters, handbook and records for leave',
    summary: [
      'Post required federal notices (FMLA, EEO “Know Your Rights”, FLSA minimum wage, USERRA, EPPA) where employees can see them, and electronically for remote workers. States add their own posters, including paid leave notices.',
      'Put leave policies in the handbook (FMLA if covered, state paid leave, sick leave, pregnancy accommodation, lactation). Keep leave and medical records confidential, separate from personnel files; FMLA records for 3 years.',
    ],
    sources: ['https://www.dol.gov/general/topics/posters', 'https://www.eeoc.gov/poster'],
  },
};

/** State paid family and medical leave programs (insurance-funded wage replacement). */
export const STATE_PFML: Record<string, Entry & { status: string }> = {
  CA: { title: 'California Paid Family Leave (PFL) and SDI', status: 'Paying benefits', summary: ['Up to 8 weeks of PFL to bond or care for a family member, plus State Disability Insurance for the worker’s own disability, funded by employee contributions. Job protection comes separately, mainly from CFRA (employers with 5 or more employees, 12 weeks) and pregnancy disability leave (up to 4 months).'], sources: ['https://edd.ca.gov/en/disability/paid-family-leave/', 'https://calcivilrights.ca.gov/family-medical-pregnancy-leave/'] },
  CO: { title: 'Colorado FAMLI', status: 'Paying benefits', summary: ['Up to 12 weeks of paid family and medical leave a year (up to 4 more for pregnancy or childbirth complications). Job protection after 180 days of employment.'], sources: ['https://famli.colorado.gov/'] },
  CT: { title: 'Connecticut Paid Leave (CT Paid Leave) and CT FMLA', status: 'Paying benefits', summary: ['Paid benefits through CT Paid Leave; job protection through CT FMLA, which covers employers with 1 or more employees.'], sources: ['https://ctpaidleave.org/', 'https://portal.ct.gov/dolui/fmla'] },
  DC: { title: 'District of Columbia Paid Family Leave', status: 'Paying benefits', summary: ['Paid parental, family, medical and prenatal leave funded by employer contributions; weeks per type are set by the program each year.'], sources: ['https://dcpaidfamilyleave.dc.gov/'] },
  DE: { title: 'Delaware Paid Leave', status: 'Benefits began January 1, 2026', summary: ['Contributions began in 2025. Up to 12 weeks of parental leave and up to 6 weeks of medical, family-caregiving or military leave in a 24-month period. Employer size affects which leave types apply.'], sources: ['https://labor.delaware.gov/delaware-paid-leave/'] },
  MA: { title: 'Massachusetts PFML', status: 'Paying benefits', summary: ['Up to 12 weeks of family leave, 20 weeks of medical leave, 26 weeks combined in a benefit year, with job protection.'], sources: ['https://www.mass.gov/orgs/department-of-family-and-medical-leave'] },
  MD: { title: 'Maryland FAMLI', status: 'Not paying benefits yet: start delayed to 2028', summary: ['The program has been delayed more than once; contributions and benefits are scheduled to start later (benefits currently scheduled for January 2028). Check the program site for the current dates.'], sources: ['https://www.labor.maryland.gov/employment/famli/'] },
  ME: { title: 'Maine Paid Family and Medical Leave', status: 'Benefits began May 1, 2026', summary: ['Contributions began January 2025. Up to 12 weeks of paid leave a benefit year for family, medical, military and safety reasons, with job protection after 120 days of employment.'], sources: ['https://maine.gov/paidleave/'] },
  MN: { title: 'Minnesota Paid Leave', status: 'Benefits and premiums began January 1, 2026', summary: ['Up to 12 weeks of medical leave and 12 weeks of family leave a benefit year, capped at 20 weeks combined, with job protection after 90 days of employment.'], sources: ['https://paidleave.mn.gov/'] },
  NJ: { title: 'New Jersey Family Leave Insurance and Temporary Disability', status: 'Paying benefits', summary: ['Up to 12 weeks of family leave insurance; job protection mainly from the NJ Family Leave Act (employers with 30 or more employees).'], sources: ['https://myleavebenefits.nj.gov/'] },
  NY: { title: 'New York Paid Family Leave', status: 'Paying benefits', summary: ['Up to 12 weeks of paid family leave with job protection, funded by employee contributions through the employer’s insurance; separate short-term disability (DBL) for the worker’s own illness. New York also requires paid prenatal leave (20 hours a year).'], sources: ['https://paidfamilyleave.ny.gov/'] },
  OR: { title: 'Paid Leave Oregon', status: 'Paying benefits', summary: ['Up to 12 weeks of paid family, medical and safe leave a benefit year (up to 2 more for pregnancy-related reasons), with job protection after 90 days of employment.'], sources: ['https://paidleave.oregon.gov/'] },
  RI: { title: 'Rhode Island Temporary Caregiver Insurance (TCI) and TDI', status: 'Paying benefits', summary: ['Paid caregiver leave through TCI and temporary disability insurance for the worker’s own illness, funded by employee contributions.'], sources: ['https://dlt.ri.gov/individuals/temporary-disability-caregiver-insurance'] },
  WA: { title: 'Washington Paid Family and Medical Leave', status: 'Paying benefits', summary: ['Up to 12 weeks of family or medical leave, 16 combined (18 with pregnancy complications) a year. Job protection after 12 months and 1,250 hours at employers with 50 or more employees (expanding under a 2025 law; check the program site).'], sources: ['https://paidleave.wa.gov/'] },
  NH: { title: 'New Hampshire Paid Family and Medical Leave (voluntary)', status: 'Voluntary program', summary: ['Employers may choose to offer coverage; not required.'], sources: ['https://paidleave.nh.gov/'] },
  VT: { title: 'Vermont Family and Medical Leave Insurance (voluntary)', status: 'Voluntary program', summary: ['Voluntary insurance program; Vermont also has its own unpaid parental and family leave law for larger employers.'], sources: ['https://www.vermontfmli.com/'] },
};

export const TOPICS = Object.keys(FEDERAL);

/** The reference text for a topic, and for a state's paid leave program when one is asked about. */
export function reference(topic: string, state?: string | null) {
  const out: (Entry & { status?: string })[] = [];
  if (FEDERAL[topic]) out.push(FEDERAL[topic]);
  if (topic === 'state_paid_leave' && !state) out.push({ title: 'States with paid family and medical leave programs', status: undefined, summary: Object.entries(STATE_PFML).map(([k, v]) => `${k}: ${v.title} — ${v.status}`), sources: [] });
  const st = state?.toUpperCase().trim();
  if (st) {
    if (STATE_PFML[st]) out.push(STATE_PFML[st]);
    else out.push({ title: `${st}: no state paid family and medical leave insurance program`, summary: ['This state has no mandatory paid family and medical leave insurance program in this reference. It may still have its own leave, sick leave or pregnancy accommodation laws. Check the state labor department.'], sources: [] });
  }
  return { reviewed: REVIEWED, entries: out };
}

/** Official sites the assistant may search for current figures and changes. */
export const OFFICIAL_DOMAINS = [
  'dol.gov', 'eeoc.gov', 'ecfr.gov', 'federalregister.gov', 'askjan.org',
  'ca.gov', 'colorado.gov', 'ct.gov', 'ctpaidleave.org', 'dc.gov', 'delaware.gov', 'mass.gov', 'maryland.gov', 'maine.gov', 'mn.gov',
  'nj.gov', 'ny.gov', 'oregon.gov', 'ri.gov', 'wa.gov', 'nh.gov', 'vermont.gov', 'vermontfmli.com', 'illinois.gov', 'michigan.gov',
  'texas.gov', 'myflorida.com', 'floridajobs.org', 'georgia.gov', 'az.gov', 'azica.gov', 'nm.gov', 'nebraska.gov', 'alaska.gov', 'pa.gov', 'ohio.gov', 'nc.gov',
];

/** Employee-count thresholds that decide which federal laws apply. */
export const THRESHOLDS = [
  { law: 'FMLA', employees: 50, note: '50+ employees in 20+ workweeks this or last calendar year (and eligibility needs 50 within 75 miles of the worksite)' },
  { law: 'ACA employer mandate', employees: 50, note: '50+ full-time employees including full-time equivalents (averaged over the prior year)' },
  { law: 'COBRA', employees: 20, note: '20+ employees on more than half of typical business days last year (smaller employers: state continuation laws)' },
  { law: 'ADEA (age discrimination)', employees: 20, note: '20+ employees in 20+ calendar weeks' },
  { law: 'Title VII, ADA, PWFA, Pregnancy Discrimination Act', employees: 15, note: '15+ employees in 20+ calendar weeks' },
  { law: 'Equal Pay Act, USERRA, PUMP Act, I-9', employees: 1, note: 'nearly all employers, regardless of size' },
];
