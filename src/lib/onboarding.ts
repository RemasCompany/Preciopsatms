// New-hire onboarding: package step definitions, starter packages, progress and the I-9 deadline.
// Shared by the UI and the server — keep this file free of server imports.
import { z } from 'zod';
import { CREDENTIAL_TYPE_NAMES } from './credentials';

export const STAFF_TASKS = {
  i9: 'Form I-9 completed',
  everify: 'E-Verify case closed',
  w4: 'Tax withholding (W-4 and state form) set up in payroll',
  direct_deposit: 'Direct deposit set up in payroll',
  background: 'Background check cleared',
  drug_screen: 'Drug screen cleared',
  orientation: 'Site orientation completed',
  other: 'Other task',
} as const;
export type StaffTask = keyof typeof STAFF_TASKS;

const base = { label: z.string().trim().min(2, 'Give every step a name.').max(120, 'Keep step names under 120 characters.'), hint: z.string().max(300).optional().nullable(), required: z.boolean().default(true) };
export const StepDef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SIGN'), ...base, doc: z.enum(['offer', 'assignment', 'custom']), title: z.string().max(200).optional().nullable(), body: z.string().max(20000).optional().nullable() }),
  z.object({ kind: z.literal('UPLOAD'), ...base, credentialType: z.string().refine((t) => CREDENTIAL_TYPE_NAMES.includes(t)).optional().nullable() }),
  z.object({ kind: z.literal('FORM'), ...base, form: z.literal('emergency_contact') }),
  z.object({ kind: z.literal('STAFF'), ...base, task: z.enum(Object.keys(STAFF_TASKS) as [StaffTask]) }),
  z.object({ kind: z.literal('CREDENTIAL'), ...base, credentialType: z.string().refine((t) => CREDENTIAL_TYPE_NAMES.includes(t), 'Choose a credential type.') }),
]).superRefine((s, ctx) => {
  if (s.kind === 'SIGN' && s.doc === 'custom' && !(s.title?.trim() && s.body?.trim())) ctx.addIssue({ code: 'custom', message: `“${s.label}” needs a document title and text.` });
});
export type StepDef = z.infer<typeof StepDef>;
export const PackageBody = z.object({
  name: z.string().trim().min(2, 'Name the package.').max(80, 'Keep the name under 80 characters.'),
  description: z.string().max(300).optional().nullable(),
  steps: z.array(StepDef).min(1, 'Add at least one step.').max(40, 'A package can have up to 40 steps.'),
});

export const STEP_KINDS = {
  SIGN: 'Sign a document', UPLOAD: 'Upload a file', FORM: 'Fill in a form', STAFF: 'Staff task', CREDENTIAL: 'Verified credential on file',
} as const;
/** Who completes each kind of step. */
export const WORKER_KINDS = new Set(['SIGN', 'UPLOAD', 'FORM']);

const HANDBOOK = `{{date}}

Employee handbook and policies acknowledgment

I acknowledge that I received and have read {{my_company}}'s employee handbook and policies, including:

- Equal employment opportunity and anti-harassment policy, and how to report a concern
- Timekeeping: I will record all hours worked accurately, clock in and out myself, and never work "off the clock"
- Attendance and call-off procedure: I will contact {{my_short}} (not only the client) as early as possible if I can't work a scheduled shift
- Safety: I will follow site safety rules, wear required protective equipment and report any injury the same day
- Drug- and alcohol-free workplace
- Confidentiality of client and company information

I understand these policies may change and that my employment is at-will.`;
const SAFETY = `{{date}}

Workplace safety acknowledgment

I understand that I must follow all safety rules at {{my_company}} client sites, including required personal protective equipment, lockout/tagout and equipment rules, and that I may only operate powered equipment (such as forklifts) after I am trained and authorized for that site.

I will report every injury, near-miss or unsafe condition to my site supervisor and to {{my_short}} right away. I will not be retaliated against for reporting.`;
const HIPAA = `{{date}}

Confidentiality and HIPAA acknowledgment

I understand that at healthcare client sites I may see protected health information (PHI). I will access, use and share PHI only as my job requires and only as the client's policies allow, will not discuss patients outside of work or on social media, and will report any privacy incident right away to my supervisor and to {{my_short}}.

I understand that violating patient privacy can lead to removal from assignment, termination and legal penalties.`;

const i9Hint = 'Section 1 by the first day of work; review documents and complete Section 2 within 3 business days of the start date.';
const payrollHint = 'The new hire enters this in your payroll provider’s onboarding portal. Mark done once it’s set up.';

/** Starting points a company can add and edit. Customers should have counsel review the document text. */
export const STARTER_PACKAGES: { name: string; description: string; steps: StepDef[] }[] = [
  { name: 'Standard new hire', description: 'Light industrial, warehouse and general staffing.', steps: [
    { kind: 'SIGN', label: 'Sign your offer letter', doc: 'offer', required: true },
    { kind: 'SIGN', label: 'Sign your assignment confirmation', doc: 'assignment', required: true },
    { kind: 'SIGN', label: 'Read and acknowledge the handbook and policies', doc: 'custom', title: 'Employee handbook and policies acknowledgment', body: HANDBOOK, required: true },
    { kind: 'SIGN', label: 'Acknowledge workplace safety rules', doc: 'custom', title: 'Workplace safety acknowledgment', body: SAFETY, required: true },
    { kind: 'FORM', label: 'Add an emergency contact', form: 'emergency_contact', required: true },
    { kind: 'UPLOAD', label: 'Upload certifications you have (e.g. forklift)', hint: 'Optional. A photo or PDF is fine.', required: false },
    { kind: 'STAFF', label: STAFF_TASKS.i9, task: 'i9', hint: i9Hint, required: true },
    { kind: 'STAFF', label: STAFF_TASKS.w4, task: 'w4', hint: payrollHint, required: true },
    { kind: 'STAFF', label: STAFF_TASKS.direct_deposit, task: 'direct_deposit', hint: payrollHint, required: false },
    { kind: 'STAFF', label: STAFF_TASKS.background, task: 'background', required: true },
    { kind: 'STAFF', label: STAFF_TASKS.drug_screen, task: 'drug_screen', hint: 'Only if the client requires one.', required: false },
  ] },
  { name: 'Healthcare new hire', description: 'Nurses, CNAs and allied health.', steps: [
    { kind: 'SIGN', label: 'Sign your offer letter', doc: 'offer', required: true },
    { kind: 'SIGN', label: 'Sign your assignment confirmation', doc: 'assignment', required: true },
    { kind: 'SIGN', label: 'Read and acknowledge the handbook and policies', doc: 'custom', title: 'Employee handbook and policies acknowledgment', body: HANDBOOK, required: true },
    { kind: 'SIGN', label: 'Sign the confidentiality and HIPAA acknowledgment', doc: 'custom', title: 'Confidentiality and HIPAA acknowledgment', body: HIPAA, required: true },
    { kind: 'FORM', label: 'Add an emergency contact', form: 'emergency_contact', required: true },
    { kind: 'UPLOAD', label: 'Upload your BLS card', credentialType: 'BLS', required: true },
    { kind: 'UPLOAD', label: 'Upload your latest TB test result', credentialType: 'TB test', required: true },
    { kind: 'CREDENTIAL', label: 'Nursing license verified', credentialType: 'RN license', hint: 'Change the type for LPN, CNA or allied roles.', required: true },
    { kind: 'STAFF', label: STAFF_TASKS.i9, task: 'i9', hint: i9Hint, required: true },
    { kind: 'STAFF', label: STAFF_TASKS.w4, task: 'w4', hint: payrollHint, required: true },
    { kind: 'STAFF', label: STAFF_TASKS.direct_deposit, task: 'direct_deposit', hint: payrollHint, required: false },
    { kind: 'STAFF', label: STAFF_TASKS.background, task: 'background', required: true },
    { kind: 'STAFF', label: 'OIG/SAM exclusion check cleared', task: 'other', required: true },
  ] },
];

/** The date Section 2 of Form I-9 is due: 3 business days after the first day of work (weekends skipped; holidays not). */
export function i9Due(startDate: string) {
  const d = new Date(`${startDate}T00:00:00Z`);
  let added = 0;
  while (added < 3) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) added++; }
  return d.toISOString().slice(0, 10);
}

export type StepState = { id: string; kind: string; label: string; required: boolean; status: 'PENDING' | 'DONE' | 'WAIVED'; config: Record<string, unknown> };
/**
 * Progress for one onboarding. CREDENTIAL steps count as done while the new hire has a current, verified
 * credential of that type (so they follow the credential if it lapses).
 */
export function progress(steps: StepState[], verifiedTypes: Set<string>) {
  const done = (s: StepState) => s.status !== 'PENDING' || (s.kind === 'CREDENTIAL' && verifiedTypes.has(String(s.config.credentialType)));
  const required = steps.filter((s) => s.required);
  const left = required.filter((s) => !done(s));
  return { total: steps.length, done: steps.filter(done).length, requiredLeft: left.length, ready: left.length === 0, next: left[0]?.label ?? null, isDone: done };
}
