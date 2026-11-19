import { db } from '@/lib/db';
import { productionProblems } from '../../../../scripts/db-url.mjs';
import { stripeStatus } from '@/lib/stripe-status';
import { emailStatus } from '@/lib/email-status';

export const dynamic = 'force-dynamic';

type Check = { name: string; ok: boolean; detail?: string };

/**
 * Uptime check for load balancers and monitors (200 when everything sign-in needs works, 503 otherwise), and a plain
 * list of what's wrong for whoever is fixing it. Names settings, never their values.
 */
export async function GET(req: Request) {
  const checks: Check[] = [];
  try { await db.$queryRaw`SELECT 1`; checks.push({ name: 'database', ok: true }); }
  catch { checks.push({ name: 'database', ok: false, detail: 'The database can’t be reached. Check DATABASE_URL in Vercel (Production).' }); }
  if (checks[0].ok) {
    // Reading every column of the sign-in tables catches a database the latest updates were never applied to.
    try { await Promise.all([db.organization.findFirst(), db.user.findFirst(), db.membership.findFirst()]); checks.push({ name: 'database tables', ok: true }); }
    catch { checks.push({ name: 'database tables', ok: false, detail: 'The database is missing the latest updates. Redeploy; if it persists, DATABASE_URL and DIRECT_URL point to different databases.' }); }
  }
  if (process.env.NODE_ENV === 'production') {
    const problems = productionProblems();
    checks.push({ name: 'sign-in settings', ok: !problems.length, ...(problems.length ? { detail: problems.join(' ') } : {}) });
  }
  const host = req.headers.get('host')?.split(':')[0] ?? null;
  let main: string | null = null;
  try { main = process.env.APP_URL ? new URL(process.env.APP_URL).hostname : null; } catch { /* reported above */ }
  const ok = checks.every((c) => c.ok);
  // Billing is reported but doesn't fail the health check (the site works without it). Details are on /platform.
  const b = await stripeStatus().catch(() => null);
  const billing = b ? { stripe: b.state === 'connected' ? `connected (${b.mode} mode)` : b.state === 'problems' ? 'needs attention (see the platform console)' : 'not connected' } : { stripe: 'unknown' };
  return Response.json({ ok, time: new Date().toISOString(), billing, email: emailStatus().ok ? 'set up' : 'not set up (see the platform console)', address: { this: host, main, ...(main && host && host !== main ? { note: `Pages on ${host} open on ${main}, where sign-in works.` } : {}) }, checks },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
