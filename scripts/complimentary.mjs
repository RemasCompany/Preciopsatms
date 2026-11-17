// Complimentary plans: companies that use Preciops free, by arrangement (list in src/lib/complimentary.json).
// Shared by the app (sign-up) and the deploy step: `node scripts/complimentary.mjs` marks every matching company.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Company names compared without case, punctuation, spacing or a legal suffix: "Eye Tek Security Services, LLC" = "EyeTek Security Services". */
export function normalizeCompany(s) {
  return String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(llc|l l c|inc|incorporated|corp|corporation|co|ltd|pllc|lp)\b/g, ' ').replace(/\s+/g, '');
}

/** The arrangement for this company, if any; when domains are listed, the email must be at one of them. */
export function complimentaryFor(list, company, email) {
  const n = normalizeCompany(company);
  const c = list.find((x) => normalizeCompany(x.name) === n);
  if (!c) return null;
  if (c.domains?.length) {
    // "www.example.com" or "example.com" in the list; the email must be at that domain or one of its subdomains.
    const d = String(email ?? '').toLowerCase().trim().split('@')[1] ?? '';
    const ok = c.domains.map((x) => x.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')).some((x) => d === x || d.endsWith(`.${x}`));
    if (!ok) return null;
  }
  return c;
}

/**
 * Marks matching companies complimentary, and ends it for companies no longer on the list (or whose owner's email isn't
 * at a listed domain): they get a fresh trial on the same plan to choose one. Returns the names it changed.
 */
export async function applyComplimentary(db, list, trialDays = Number(process.env.TRIAL_DAYS ?? 14)) {
  const changed = [];
  const orgs = await db.organization.findMany({ select: { id: true, name: true, plan: true, subscriptionStatus: true, complimentary: true, complimentaryBy: true } });
  for (const o of orgs) {
    const owner = await db.membership.findFirst({ where: { organizationId: o.id, role: 'OWNER' }, orderBy: { createdAt: 'asc' }, select: { user: { select: { email: true } } } });
    const c = complimentaryFor(list, o.name, owner?.user.email);
    // Only free plans this list granted are taken back; ones a platform admin granted stay.
    const fromList = !o.complimentaryBy || o.complimentaryBy === 'list';
    if (!c && o.complimentary && fromList) {
      await db.organization.update({ where: { id: o.id }, data: { complimentary: false, complimentaryNote: null, subscriptionStatus: 'trialing', trialEndsAt: new Date(Date.now() + trialDays * 864e5) } });
      changed.push(`${o.name} (ended; trial started)`);
      continue;
    }
    if (!c || (o.complimentary && o.plan === c.plan && o.subscriptionStatus === 'active')) continue;
    await db.organization.update({ where: { id: o.id }, data: { plan: c.plan, subscriptionStatus: 'active', trialEndsAt: null, complimentary: true, complimentaryNote: c.note ?? null, complimentaryBy: 'list' } });
    changed.push(o.name);
  }
  return changed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const list = JSON.parse(readFileSync(new URL('../src/lib/complimentary.json', import.meta.url), 'utf8')).companies;
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  try {
    const changed = await applyComplimentary(db, list);
    console.log(changed.length ? `[complimentary] Now complimentary: ${changed.join(', ')}.` : `[complimentary] No changes (${list.length} on the list).`);
  } catch (e) {
    // Never block a deploy over this; it runs again next time and at sign-up.
    console.warn(`[complimentary] Skipped: ${e.message}`);
  } finally { await db.$disconnect(); }
}
