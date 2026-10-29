// Which Postgres connection strings to use, from whatever the host provides. Shared by the deploy step
// (scripts/migrate.mjs) and the app (src/lib/db.ts). Vercel's Neon integration names them its own way
// (DATABASE_URL_UNPOOLED, POSTGRES_PRISMA_URL, POSTGRES_URL_NON_POOLING…), and values pasted from a dashboard often
// carry quotes, spaces or the whole `psql '…'` command, so those are cleaned up rather than failing on them.

const RUNTIME = ['DATABASE_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL'];
const DIRECT = ['DIRECT_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_URL_NO_SSL'];

/** A usable postgres:// URL from a raw value, or null. Strips quotes, whitespace and a leading `psql`. */
export function cleanUrl(raw) {
  if (!raw) return null;
  let v = String(raw).trim();
  v = v.replace(/^psql\s+/i, '').trim();
  v = v.replace(/^(['"])(.*)\1$/, '$2').trim();
  return /^postgres(ql)?:\/\/\S+$/.test(v) ? v : null;
}

/** The first good URL among `names`, and notes about any that were set but unusable (names only, never values). */
function first(env, names) {
  const problems = [];
  for (const n of names) {
    if (env[n] === undefined || env[n] === '') continue;
    const u = cleanUrl(env[n]);
    if (u) return { name: n, url: u, problems };
    problems.push(`${n} is set but isn't a postgres:// connection string`);
  }
  return { name: null, url: null, problems };
}

/** { runtime, migrate } connection strings (migrate prefers a direct, non-pooled one) and any problems found. */
export function pickDatabaseUrls(env = process.env) {
  const run = first(env, RUNTIME), direct = first(env, DIRECT);
  return {
    runtime: run.url, runtimeFrom: run.name,
    migrate: direct.url ?? run.url, migrateFrom: direct.url ? direct.name : run.name,
    problems: [...run.problems, ...direct.problems],
  };
}
