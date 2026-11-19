export type Complimentary = { name: string; plan: 'starter' | 'growth' | 'enterprise'; domains: string[]; note: string };
export function normalizeCompany(s: string): string;
export function atDomain(entry: Complimentary, email?: string | null): boolean;
export function complimentaryFor<T extends Complimentary>(list: T[], company: string, email?: string | null, verified?: boolean): T | null;
export function applyComplimentary(db: unknown, list: Complimentary[], trialDays?: number, only?: string[]): Promise<string[]>;
