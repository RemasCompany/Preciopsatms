import list from './complimentary.json';
import { complimentaryFor as match, normalizeCompany, type Complimentary } from '../../scripts/complimentary.mjs';

export { normalizeCompany };
export const COMPLIMENTARY = list.companies as Complimentary[];

/** The arrangement for this company, if it has one (and, when domains are listed, the email is at one of them). */
export const complimentaryFor = (company: string, email?: string | null) => match(COMPLIMENTARY, company, email);

/** What a complimentary company's record is set to. */
export const complimentaryData = (c: Complimentary) => ({ plan: c.plan, subscriptionStatus: 'active', trialEndsAt: null, complimentary: true, complimentaryNote: c.note });
