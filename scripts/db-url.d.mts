export function cleanUrl(raw: string | undefined | null): string | null;
export function pickDatabaseUrls(env?: Record<string, string | undefined>): { runtime: string | null; runtimeFrom: string | null; migrate: string | null; migrateFrom: string | null; problems: string[] };
export function sameDatabase(a: string, b: string): boolean;
export function productionProblems(env?: Record<string, string | undefined>): string[];
