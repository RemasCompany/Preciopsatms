// HR internal audit: what's checked automatically from the company's own records, the checklist of practices software
// can't see, and how an audit is scored. Pure (tested); the data loading is in hr-audit-server.ts.
// These are flags to review with HR counsel, not legal advice. Figures were current in October 2026.

export type Severity = 'high' | 'medium' | 'low' | 'info';
export type FindingItem = { id: string; name: string; detail: string };
export type Finding = { key: string; title: string; severity: Severity; why: string; fix: string; href: string; items: FindingItem[] };

/** Federal FLSA minimum salary for the white-collar exemptions ($684/week): the 2024 increase was vacated and rescinded. */
export const EXEMPT_SALARY_WEEKLY = 684;
export const EXEMPT_SALARY_YEARLY = EXEMPT_SALARY_WEEKLY * 52; // $35,568
export const FEDERAL_MIN_WAGE = 7.25;

/** Every automatic check, in the order shown. A check with no items passes. */
export const CHECKS: Record<string, Omit<Finding, 'key' | 'items'>> = {
  i9_missing: { title: 'Form I-9 not recorded as complete', severity: 'high', href: '/app/onboarding',
    why: 'Section 2 is due within 3 business days of the first day of work. Missing or late I-9s are the most common finding in an ICE inspection, with fines per form.',
    fix: 'Complete the I-9 and mark the “Form I-9 completed” step in their onboarding. If it’s on paper, mark it done and keep the form with your I-9 files.' },
  everify_overdue: { title: 'E-Verify cases past their deadline', severity: 'high', href: '/app/everify',
    why: 'An E-Verify case has to be created by the third business day after the person starts work.',
    fix: 'Create the case in E-Verify now, note the reason it’s late, and record the case number.' },
  pay_below_minimum: { title: 'Hourly pay below the federal minimum wage', severity: 'high', href: '/app/employees',
    why: `The federal minimum is $${FEDERAL_MIN_WAGE.toFixed(2)} an hour, and most states set a higher one.`,
    fix: 'Correct the rate, check the state and local minimum where they work, and pay back any shortfall.' },
  aca_offer_due: { title: 'Full-time under the ACA with no offer of coverage', severity: 'high', href: '/app/aca',
    why: 'Applicable large employers can owe a penalty for each month a full-time employee goes without an offer of coverage.',
    fix: 'Offer coverage (or record the offer already made) on the ACA tracking page.' },
  exempt_below_threshold: { title: 'Salaried below the federal exempt threshold', severity: 'medium', href: '/app/employees',
    why: `Salaried employees paid under $${EXEMPT_SALARY_WEEKLY}/week ($${EXEMPT_SALARY_YEARLY.toLocaleString('en-US')}/year) generally must get overtime. California, New York, Washington, Colorado and others set higher thresholds.`,
    fix: 'Confirm whether they’re treated as exempt. If so, raise the salary to the threshold or pay overtime for hours over 40.' },
  w4_missing: { title: 'No W-4 on record', severity: 'medium', href: '/app/onboarding',
    why: 'Payroll needs a W-4 to withhold federal income tax; without one, withholding defaults to single with no adjustments.',
    fix: 'Request the W-4 from their record (Hiring documents) or mark it done in onboarding if payroll already has it.' },
  credentials_expired: { title: 'Expired credentials on active workers', severity: 'medium', href: '/app/credentials',
    why: 'Working with an expired license or certification can breach state law, client contracts or OSHA rules.',
    fix: 'Collect the renewed credential and verify it, or take the person off work that needs it.' },
  onboarding_stalled: { title: 'Onboarding unfinished a week after the start date', severity: 'medium', href: '/app/onboarding',
    why: 'Unsigned policies and missing documents leave gaps in the personnel file.',
    fix: 'Follow up on the open steps, or waive the ones that don’t apply.' },
  offboarding_overdue: { title: 'Offboarding tasks past due', severity: 'medium', href: '/app/offboarding',
    why: 'Late final pay can carry state penalties, and unreturned equipment or open system access is a security risk.',
    fix: 'Finish or reassign the overdue tasks; final pay first.' },
  admin_no_two_step: { title: 'Owners and admins without two-step sign-in', severity: 'medium', href: '/app/team',
    why: 'Owners and admins can see pay, I-9 documents and personal data; a stolen password alone shouldn’t be enough to get in.',
    fix: 'Ask them to turn on two-step sign-in under My sign-in, or require it for the team.' },
  reviews_overdue: { title: 'Performance reviews overdue', severity: 'low', href: '/app/reviews',
    why: 'Late or missing reviews weaken the record behind pay and discipline decisions.',
    fix: 'Ask the managers listed to submit their reviews.' },
  timeoff_waiting: { title: 'Time-off requests waiting over a week', severity: 'low', href: '/app/time-off',
    why: 'Slow decisions on leave requests can look like interference with protected leave (FMLA, state sick leave).',
    fix: 'Approve or decline them, with a reason when declining.' },
  emergency_contact_missing: { title: 'Active employees without an emergency contact', severity: 'low', href: '/app/employees',
    why: 'You need someone to call if an employee is hurt or ill at work.',
    fix: 'Ask them to finish their profile on their employee page.' },
  i9_destroy: { title: 'Former employees’ I-9s past their retention date', severity: 'info', href: '/app/employees',
    why: 'I-9s must be kept until the later of 3 years after hire or 1 year after employment ends. Keeping them longer than that adds exposure in an inspection.',
    fix: 'Securely destroy these I-9s and their document copies (paper and electronic).' },
};

export type ChecklistItem = { key: string; text: string; why: string; staffingOnly?: boolean };

/** Practices the records can't show. Answered Yes / No / Not applicable, with a note. */
export const CHECKLIST: ChecklistItem[] = [
  { key: 'posters', text: 'Required federal, state and local labor law posters are up where employees see them, and shared electronically with remote staff.', why: 'FLSA, EEO, FMLA (50+ employees), OSHA and state notices are required.' },
  { key: 'handbook', text: 'The employee handbook was reviewed in the last 12 months, and every employee’s acknowledgment is on file.', why: 'Laws on leave, pay and conduct change often.' },
  { key: 'i9_storage', text: 'I-9s are kept apart from personnel files, and document copies are kept for everyone or no one.', why: 'Keeps immigration documents out of other decisions and limits inspection scope.' },
  { key: 'medical', text: 'Medical information (ADA accommodations, FMLA certifications, drug tests) is stored separately and confidentially.', why: 'The ADA and GINA require medical records to be kept apart and confidential.' },
  { key: 'job_descriptions', text: 'Job descriptions are current, and each job’s exempt / non-exempt classification was reviewed.', why: 'Misclassification is a leading source of wage-and-hour claims.' },
  { key: 'contractors', text: 'Anyone paid as an independent contractor was reviewed against the IRS and state tests.', why: 'Several states use the stricter “ABC” test.' },
  { key: 'harassment_training', text: 'Harassment-prevention training was completed where the law requires it.', why: 'Required in California, New York, Illinois, Connecticut, Delaware and Maine, among others.' },
  { key: 'workers_comp', text: 'Workers’ compensation coverage is in force in every state where people work.', why: 'Coverage is required for employees in nearly every state.' },
  { key: 'pay_equity', text: 'Pay was reviewed for gaps by gender and race in the last 12 months, and state pay data reports were filed where required.', why: 'Federal and state equal-pay laws; California and Illinois require pay data reports.' },
  { key: 'eeo1', text: 'The EEO-1 report was filed, if you have 100 or more employees (50 or more for federal contractors).', why: 'Filed with the EEOC each year.' },
  { key: 'records_retention', text: 'Payroll records are kept at least 3 years and time records at least 2, under a written retention schedule.', why: 'FLSA recordkeeping; state rules can require longer.' },
  { key: 'new_hire_reporting', text: 'New hires are reported to the state within the required time (usually 20 days).', why: 'Required for child-support enforcement in every state.' },
  { key: 'background_fcra', text: 'Background checks follow the FCRA steps (standalone disclosure, written authorization, adverse-action notices) and local fair-chance rules.', why: 'FCRA violations carry statutory damages per person.' },
  { key: 'leave_policies', text: 'Leave policies cover FMLA (50+ employees) and every state and city paid sick leave law where people work.', why: 'Many states and cities require paid sick leave.' },
  { key: 'osha_logs', text: 'The OSHA 300 injury log is kept, and the 300A summary is posted from February 1 to April 30, if required.', why: 'Required for most employers with more than 10 employees in non-exempt industries.' },
  { key: 'client_contracts', text: 'Client contracts say who handles site safety training, PPE and supervision of placed workers.', why: 'Staffing agencies and their clients share OSHA and joint-employer duties.', staffingOnly: true },
];

export const checklistFor = (kind: 'STAFFING' | 'EMPLOYER') => CHECKLIST.filter((c) => !c.staffingOnly || kind === 'STAFFING');

export type Answer = { answer: 'yes' | 'no' | 'na'; note?: string };
export type Answers = Record<string, Answer>;
export type Reviews = Record<string, { note: string; by: string; at: string }>;

const WEIGHT: Record<Severity, number> = { high: 3, medium: 2, low: 1, info: 0 };

/**
 * The score out of 100: each automatic check (weighted by severity) and each checklist item counts. A check passes
 * when it has nothing listed or an admin reviewed it with a note; a checklist item passes on Yes, and Not applicable
 * drops out. Unanswered items count as not passing, so a half-finished audit can't score high.
 */
export function score(findings: Finding[], answers: Answers, reviews: Reviews, items: ChecklistItem[]) {
  let got = 0, max = 0;
  for (const f of findings) {
    const w = WEIGHT[f.severity];
    if (!w) continue;
    max += w;
    if (!f.items.length || reviews[f.key]) got += w;
  }
  for (const c of items) {
    const a = answers[c.key]?.answer;
    if (a === 'na') continue;
    max += 2;
    if (a === 'yes') got += 2;
  }
  return max ? Math.round((got / max) * 100) : 100;
}

export const openFindings = (findings: Finding[], reviews: Reviews) => findings.filter((f) => f.items.length && !reviews[f.key] && f.severity !== 'info');
export const unanswered = (answers: Answers, items: ChecklistItem[]) => items.filter((c) => !answers[c.key]);

/** When a former employee's I-9 can be destroyed: the later of 3 years after hire and 1 year after employment ended. */
export function i9RetainUntil(hired: string, ended: string) {
  const plus = (d: string, y: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCFullYear(x.getUTCFullYear() + y); return x.toISOString().slice(0, 10); };
  const a = plus(hired, 3), b = plus(ended, 1);
  return a > b ? a : b;
}

/** The audit as CSV: one row per automatic finding (with each person) and per checklist answer. */
export function auditCsv(a: { title: string; status: string; startedAt: string; completedAt: string | null; score: number | null }, findings: Finding[], answers: Answers, reviews: Reviews, items: ChecklistItem[]) {
  const q = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };
  const rows: unknown[][] = [
    ['Audit', a.title], ['Status', a.status], ['Started', a.startedAt.slice(0, 10)], ['Completed', a.completedAt?.slice(0, 10) ?? ''], ['Score', a.score ?? ''], [],
    ['Section', 'Check', 'Severity', 'Result', 'Person', 'Detail', 'Review note'],
  ];
  for (const f of findings) {
    const r = reviews[f.key];
    if (!f.items.length) rows.push(['Automatic', f.title, f.severity, 'Pass', '', '', '']);
    else for (const i of f.items) rows.push(['Automatic', f.title, f.severity, r ? 'Reviewed' : 'Open', i.name, i.detail, r?.note ?? '']);
  }
  for (const c of items) { const x = answers[c.key]; rows.push(['Checklist', c.text, '', x ? { yes: 'Yes', no: 'No', na: 'Not applicable' }[x.answer] : 'Not answered', '', '', x?.note ?? '']); }
  return rows.map((r) => r.map(q).join(',')).join('\n') + '\n';
}
