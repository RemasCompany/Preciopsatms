// Single source of truth for pricing, packaging and feature gating.
export type PlanId = 'starter' | 'growth' | 'enterprise';
export type Feature =
  | 'ats' | 'crm' | 'leads' | 'careers' | 'vendors' | 'messaging'
  | 'timesheets' | 'esign' | 'ai' | 'eeo' | 'api' | 'sso' | 'whitelabel' | 'credentials' | 'scheduling' | 'payrollRuns' | 'timeclock';

export const PLANS: Record<PlanId, {
  name: string; priceEnv: string; perSeat: boolean; maxSeats: number | null;
  monthlyAiCredits: number; features: Feature[]; blurb: string; displayPrice: string;
}> = {
  starter: {
    name: 'Starter', priceEnv: 'STRIPE_PRICE_STARTER', perSeat: false, maxSeats: 3, monthlyAiCredits: 200,
    features: ['ats', 'crm', 'leads', 'careers', 'messaging'],
    blurb: 'Applicant tracking, CRM, lead tracking and a careers page for small agencies.', displayPrice: '$99/mo · up to 3 users',
  },
  growth: {
    name: 'Growth', priceEnv: 'STRIPE_PRICE_GROWTH', perSeat: true, maxSeats: null, monthlyAiCredits: 2000,
    features: ['ats', 'crm', 'leads', 'careers', 'messaging', 'vendors', 'timesheets', 'esign', 'ai', 'credentials', 'scheduling', 'timeclock'],
    blurb: 'Everything to run a staffing desk: timesheets, payroll export, invoicing, e-signatures, credential tracking, shift scheduling, a mobile time clock, vendors and AI.', displayPrice: '$79/user/mo',
  },
  enterprise: {
    name: 'Enterprise / MSP', priceEnv: 'STRIPE_PRICE_ENTERPRISE', perSeat: true, maxSeats: null, monthlyAiCredits: 10000,
    features: ['ats', 'crm', 'leads', 'careers', 'messaging', 'vendors', 'timesheets', 'esign', 'ai', 'credentials', 'scheduling', 'timeclock', 'payrollRuns', 'eeo', 'api', 'sso', 'whitelabel'],
    blurb: 'Payroll runs with provider exports, EEO/OFCCP reporting, API, SSO, white-label and dedicated onboarding.', displayPrice: 'Custom',
  },
};

export const ACTIVE_STATUSES = new Set(['trialing', 'active']);

export function hasFeature(org: { plan: PlanId; subscriptionStatus: string }, f: Feature) {
  return ACTIVE_STATUSES.has(org.subscriptionStatus) && PLANS[org.plan].features.includes(f);
}

export function priceIdFor(plan: PlanId) {
  const id = process.env[PLANS[plan].priceEnv];
  if (!id) throw new Error(`Missing ${PLANS[plan].priceEnv}`);
  return id;
}

export function planFromPriceId(priceId: string): PlanId | null {
  for (const [k, p] of Object.entries(PLANS)) if (process.env[p.priceEnv] === priceId) return k as PlanId;
  return null;
}
