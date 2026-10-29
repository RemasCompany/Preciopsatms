export function cleanUrl(raw: string | undefined | null): string | null;
export function pickDatabaseUrls(env?: Record<string, string | undefined>): { runtime: string | null; runtimeFrom: string | null; migrate: string | null; migrateFrom: string | null; problems: string[] };
