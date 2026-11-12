// Deploy step: apply pending database migrations, using a direct (non-pooled) connection when there is one.
// Fails with a plain explanation, naming the variables involved but never printing their values.
import { spawnSync } from 'node:child_process';
import { pickDatabaseUrls, productionProblems } from './db-url.mjs';

const { runtime, migrate, migrateFrom, problems } = pickDatabaseUrls();
for (const p of problems) console.warn(`[migrate] ${p}; skipping it.`);
if (!migrate) {
  console.error([
    '[migrate] No database connection string found, so migrations can’t run.',
    'Set DATABASE_URL (the pooled Neon string) and DIRECT_URL (the direct one, without "-pooler" in the host) for the Production environment',
    'in Vercel → Settings → Environment Variables. Paste only the string that starts with postgresql:// (not the psql command, no quotes).',
  ].join('\n'));
  process.exit(1);
}
if (!runtime) console.warn('[migrate] DATABASE_URL isn’t set to a postgres:// string. Migrations will run, but the app needs it at runtime too.');
// A production deploy with these wrong would go live and then fail at sign-in, so stop here and say what to fix.
if (process.env.VERCEL_ENV === 'production') {
  const bad = productionProblems();
  if (bad.length) {
    console.error(['[deploy] This deploy was stopped so the live site keeps working. Fix these in Vercel → Settings → Environment Variables (Production), then redeploy:', ...bad.map((b) => `  • ${b}`)].join('\n'));
    process.exit(1);
  }
}
console.log(`[migrate] Applying migrations using ${migrateFrom}.`);
const r = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: migrate } });
process.exit(r.status ?? 1);
