export type Complimentary = { name: string; plan: 'starter' | 'growth' | 'enterprise'; domains: string[]; note: string };
export function normalizeCompany(s: string): string;
export function complimentaryFor<T extends Complimentary>(list: T[], company: string, email?: string | null): T | null;
export function applyComplimentary(db: unknown, list: Complimentary[]): Promise<string[]>;
