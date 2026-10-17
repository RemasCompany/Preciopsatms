// Single source of truth for pricing, packaging and feature gating.
export type PlanId = 'starter' | 'growth' | 'enterprise';
export type OrgKind = 'STAFFING' | 'EMPLOYER';
export type Feature =
  | 'ats' | 'crm' | 'leads' | 'careers' | 'vendors' | 'messaging'
  | 'timesheets' | 'esign' | 'ai' | 'eeo' | 'api' | 'sso' | 'whitelabel' | 'credentials' | 'scheduling' | 'payrollRuns' | 'timeclock' | 'onboarding' | 'engagement' | 'clientPortal' | 'training'
  | 'people' | 'invoicing' | 'timeoff' | 'reviews' | 'vms' | 'aca';

export const PLANS: Record<PlanId, {
  name: string; priceEnv: string; perSeat: boolean; maxSeats: number | null;
  monthlyAiCredits: number; features: Feature[]; blurb: string; displayPrice: string;
  /** Employers pay per active employee on every tier (a separate Stripe price). */
  employer: { name: string; priceEnv: string; blurb: string; displayPrice: string };
}> = {
  starter: {
    name: 'Starter', priceEnv: 'STRIPE_PRICE_STARTER', perSeat: false, maxSeats: 3, monthlyAiCredits: 200,
    features: ['ats', 'crm', 'leads', 'careers', 'messaging', 'people'],
    blurb: 'Applicant tracking, CRM, lead tracking and a careers page for small agencies.', displayPrice: '$99/mo · up to 3 users',
    employer: { name: 'Starter', priceEnv: 'STRIPE_PRICE_STARTER_EMPLOYER', displayPrice: '$4/employee/mo · up to 3 admins', blurb: 'Hiring, a careers page and an employee directory with departments, an org chart and pay history.' },
  },
  growth: {
    name: 'Growth', priceEnv: 'STRIPE_PRICE_GROWTH', perSeat: true, maxSeats: null, monthlyAiCredits: 2000,
    features: ['ats', 'crm', 'leads', 'careers', 'messaging', 'vendors', 'timesheets', 'invoicing', 'esign', 'ai', 'credentials', 'scheduling', 'timeclock', 'onboarding', 'engagement', 'clientPortal', 'people', 'timeoff', 'reviews', 'aca'],
    blurb: 'Everything to run a staffing desk: timesheets, payroll export, invoicing, e-signatures, credential tracking, shift scheduling, a mobile time clock, new-hire onboarding, vendors and AI.', displayPrice: '$79/user/mo',
    employer: { name: 'Growth', priceEnv: 'STRIPE_PRICE_GROWTH_EMPLOYER', displayPrice: '$8/employee/mo', blurb: 'Everything to run your workforce: time off and balances, performance reviews and goals, scheduling, a mobile time clock, timesheets and payroll export, onboarding, e-signatures, credentials, engagement and AI.' },
  },
  enterprise: {
    name: 'Enterprise / MSP', priceEnv: 'STRIPE_PRICE_ENTERPRISE', perSeat: true, maxSeats: null, monthlyAiCredits: 10000,
    features: ['ats', 'crm', 'leads', 'careers', 'messaging', 'vendors', 'timesheets', 'invoicing', 'esign', 'ai', 'credentials', 'scheduling', 'timeclock', 'onboarding', 'engagement', 'clientPortal', 'payrollRuns', 'eeo', 'api', 'sso', 'whitelabel', 'training', 'people', 'timeoff', 'reviews', 'vms', 'aca'],
    blurb: 'Payroll runs with provider exports, equipment operator training and certification, EEO/OFCCP reporting, API, SSO, white-label and dedicated onboarding.', displayPrice: 'Custom',
    employer: { name: 'Enterprise', priceEnv: 'STRIPE_PRICE_ENTERPRISE_EMPLOYER', displayPrice: 'Custom', blurb: 'Payroll runs with provider exports, equipment operator training and certification, EEO reporting, API, SSO and dedicated onboarding.' },
  },
};

export const ACTIVE_STATUSES = new Set(['trialing', 'active']);

/** Whether the plan includes a feature (regardless of the company's own on/off choices). */
export function planIncludes(org: { plan: PlanId; subscriptionStatus: string }, f: Feature) {
  return ACTIVE_STATUSES.has(org.subscriptionStatus) && PLANS[org.plan].features.includes(f);
}

/** Client-facing features an employer has no use for: clients, sales, vendors, the client portal and client invoicing. */
export const STAFFING_ONLY: Feature[] = ['crm', 'leads', 'vendors', 'clientPortal', 'invoicing', 'vms'];

type GateOrg = { plan: PlanId; subscriptionStatus: string; onboardingEnabled?: boolean; kind?: OrgKind; hrEnabled?: boolean };
/**
 * Whether a feature is available and switched on. Companies can turn onboarding off (e.g. direct-hire firms);
 * employers don't get the staffing-only features; staffing agencies get employee records only if they turn them on.
 */
export function hasFeature(org: GateOrg, f: Feature) {
  if (f === 'onboarding' && org.onboardingEnabled === false) return false;
  if (org.kind === 'EMPLOYER' && STAFFING_ONLY.includes(f)) return false;
  if ((f === 'people' || f === 'timeoff' || f === 'reviews') && org.kind !== 'EMPLOYER' && !org.hrEnabled) return false;
  return planIncludes(org, f);
}

/** Name, price and description as a company of this kind sees them. */
export function planView(plan: PlanId, kind: OrgKind = 'STAFFING') {
  const p = PLANS[plan];
  return kind === 'EMPLOYER' ? { name: p.employer.name, displayPrice: p.employer.displayPrice, blurb: p.employer.blurb } : { name: p.name, displayPrice: p.displayPrice, blurb: p.blurb };
}

/** Employers are billed per active employee on every plan; agencies per user on per-seat plans. */
export const billedPerEmployee = (kind: OrgKind | undefined) => kind === 'EMPLOYER';

export function priceIdFor(plan: PlanId, kind: OrgKind = 'STAFFING') {
  const env = kind === 'EMPLOYER' ? PLANS[plan].employer.priceEnv : PLANS[plan].priceEnv;
  const id = process.env[env];
  if (!id) throw new Error(`Missing ${env}`);
  return id;
}

export function planFromPriceId(priceId: string): PlanId | null {
  for (const [k, p] of Object.entries(PLANS)) if (process.env[p.priceEnv] === priceId || process.env[p.employer.priceEnv] === priceId) return k as PlanId;
  return null;
}
