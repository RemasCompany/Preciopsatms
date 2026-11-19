import list from './complimentary.json';
import { applyComplimentary, complimentaryFor as match, normalizeCompany, type Complimentary } from '../../scripts/complimentary.mjs';
import { db } from './db';

export { normalizeCompany };
export const COMPLIMENTARY = list.companies as Complimentary[];

/** The arrangement for this company, if it has one (and, when domains are listed, the email is at one of them). */
export const complimentaryFor = (company: string, email?: string | null, verified = true) => match(COMPLIMENTARY, company, email, verified);

/** After someone confirms their email: the companies they own get their free plan if they qualify. */
export async function grantForUser(userId: string) {
  const owned = await db.membership.findMany({ where: { userId, role: 'OWNER' }, select: { organizationId: true } });
  return owned.length ? applyComplimentary(db, COMPLIMENTARY, undefined, owned.map((m) => m.organizationId)) : [];
}

/** What a complimentary company's record is set to. */
export const complimentaryData = (c: Complimentary) => ({ plan: c.plan, subscriptionStatus: 'active', trialEndsAt: null, complimentary: true, complimentaryNote: c.note, complimentaryBy: 'list' });
