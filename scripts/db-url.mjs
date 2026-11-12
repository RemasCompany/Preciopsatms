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

/** Whether two connection strings reach the same database (a pooled and a direct string for one Neon database do). */
export function sameDatabase(a, b) {
  try {
    const x = new URL(a), y = new URL(b);
    const host = (u) => u.hostname.toLowerCase().replace('-pooler.', '.');
    return host(x) === host(y) && x.pathname.replace(/^\//, '') === y.pathname.replace(/^\//, '');
  } catch { return false; }
}

const httpsHost = (v) => { try { const u = new URL(String(v).trim()); return u.protocol === 'https:' ? u.hostname : null; } catch { return null; } };

/**
 * Settings a production deploy can't work without, as plain sentences (names only, never values). Sign-in needs
 * NEXTAUTH_SECRET and one https address in NEXTAUTH_URL and APP_URL (the same one); the app has to use the database
 * the migrations went to.
 */
export function productionProblems(env = process.env) {
  const out = [];
  const secret = String(env.NEXTAUTH_SECRET ?? '').trim();
  if (!secret) out.push('NEXTAUTH_SECRET is missing. Without it nobody can sign in. Set it to a long random value (openssl rand -base64 32).');
  else if (secret.length < 32) out.push('NEXTAUTH_SECRET is shorter than 32 characters. Use a long random value (openssl rand -base64 32).');
  const auth = httpsHost(env.NEXTAUTH_URL), app = httpsHost(env.APP_URL);
  if (!auth) out.push('NEXTAUTH_URL must be the site’s https:// address, e.g. https://app.preciopsatms.com. Sign-in sends people back to it.');
  if (!app) out.push('APP_URL must be the site’s https:// address (the same as NEXTAUTH_URL).');
  if (auth && app && auth !== app) out.push(`NEXTAUTH_URL (${auth}) and APP_URL (${app}) are different addresses. Use the same one for both, or sign-in breaks on one of them.`);
  const { runtime, runtimeFrom, migrate, migrateFrom } = pickDatabaseUrls(env);
  if (runtime && migrate && !sameDatabase(runtime, migrate))
    out.push(`${runtimeFrom} (what the app uses) and ${migrateFrom} (where database updates are applied) point to different databases. Make them the pooled and direct strings of the same Neon database, or the app runs on a database that was never set up.`);
  return out;
}
