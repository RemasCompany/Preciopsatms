// Complimentary plans: companies that use Preciops free, by arrangement (list in src/lib/complimentary.json).
// Shared by the app (sign-up) and the deploy step: `node scripts/complimentary.mjs` marks every matching company.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Company names compared without case, punctuation, spacing or a legal suffix: "Eye Tek Security Services, LLC" = "EyeTek Security Services". */
export function normalizeCompany(s) {
  return String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(llc|l l c|inc|incorporated|corp|corporation|co|ltd|pllc|lp)\b/g, ' ').replace(/\s+/g, '');
}

const host = (x) => String(x).toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
/** Is this email at one of the entry's domains (or a subdomain)? */
export function atDomain(entry, email) {
  const d = String(email ?? '').toLowerCase().trim().split('@')[1] ?? '';
  return !!d && (entry.domains ?? []).map(host).some((x) => d === x || d.endsWith(`.${x}`));
}

/**
 * The arrangement for this company, if any.
 * - An entry with domains matches an owner whose email is at one of them, whatever the company is called, but only
 *   once that email is confirmed (anyone can type an address they don't own). Pass verified = false for an unconfirmed one.
 * - An entry without domains matches on the company name.
 */
export function complimentaryFor(list, company, email, verified = true) {
  const n = normalizeCompany(company);
  for (const c of list) {
    if (c.domains?.length) { if (verified && atDomain(c, email)) return c; }
    else if (normalizeCompany(c.name) === n) return c;
  }
  return null;
}

/** Marks matching companies complimentary, and ends it for list-granted companies that no longer match. Returns what changed. */
export async function applyComplimentary(db, list, trialDays = Number(process.env.TRIAL_DAYS ?? 14), only) {
  const changed = [];
  const orgs = await db.organization.findMany({ where: only ? { id: { in: only } } : {}, select: { id: true, name: true, plan: true, subscriptionStatus: true, complimentary: true, complimentaryBy: true } });
  for (const o of orgs) {
    const owners = (await db.membership.findMany({ where: { organizationId: o.id, role: 'OWNER' }, select: { user: { select: { email: true, emailVerifiedAt: true } } } })).map((m) => m.user);
    const c = owners.map((u) => complimentaryFor(list, o.name, u.email, !!u.emailVerifiedAt)).find(Boolean) ?? null;
    // Only free plans this list granted are taken back, and only when no owner is at a listed domain any more
    // (an owner who hasn't confirmed their email yet doesn't lose it).
    const fromList = !o.complimentaryBy || o.complimentaryBy === 'list';
    const stillOurs = owners.some((u) => list.some((e) => e.domains?.length ? atDomain(e, u.email) : normalizeCompany(e.name) === normalizeCompany(o.name)));
    if (!c && o.complimentary && fromList && !stillOurs) {
      await db.organization.update({ where: { id: o.id }, data: { complimentary: false, complimentaryNote: null, complimentaryBy: null, subscriptionStatus: 'trialing', trialEndsAt: new Date(Date.now() + trialDays * 864e5), trialNotice: -1 } });
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
