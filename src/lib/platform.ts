import { getServerSession } from 'next-auth';
import type { Organization } from '@prisma/client';
import { authOptions } from './auth';
import { db } from './db';
import { HttpError } from './tenant';
import { planView } from './plans';
import { stripe, stripeEnabled } from './stripe';

/**
 * The platform console (/platform): Preciops' own team manages every customer company. Only people whose sign-in email
 * is listed (PLATFORM_ADMIN_EMAILS) or at a listed domain (PLATFORM_ADMIN_DOMAINS) get in, and only with a confirmed
 * email and two-step sign-in (or single sign-on), since it reaches every company. Everyone else gets a plain 404.
 * It reads across companies on purpose and changes nothing.
 */
const DEFAULT_EMAILS = ''; // the default domain below already covers the team
const DEFAULT_DOMAINS = 'remascompany.com';
const listOf = (s: string | undefined, d: string) => (s ?? d).split(',').map((x) => x.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);

export function isPlatformEmail(email: string | null | undefined) {
  const e = (email ?? '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return false;
  return listOf(process.env.PLATFORM_ADMIN_EMAILS, DEFAULT_EMAILS).includes(e) || listOf(process.env.PLATFORM_ADMIN_DOMAINS, DEFAULT_DOMAINS).includes(e.slice(at + 1));
}

export type PlatformAdmin = { id: string; email: string; name: string | null };
/** null: not a platform admin (show 404). "setup": a platform email that still needs a confirmed email or two-step sign-in. */
export async function platformAdmin(): Promise<PlatformAdmin | null | { setup: string[]; email: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  const u = await db.user.findUnique({ where: { id: session.user.id } });
  if (!u || !isPlatformEmail(u.email)) return null;
  const iat = session.user.issuedAt;
  if (u.passwordChangedAt && (!iat || iat * 1000 < u.passwordChangedAt.getTime() - 1000)) return null;
  const setup = [...(!u.emailVerifiedAt ? ['Confirm your email address (use the link we emailed you, or “Send it again” at the top of the app).'] : []),
    ...(!u.totpEnabledAt && session.user.via !== 'sso' ? ['Turn on two-step sign-in under My sign-in.'] : [])];
  if (setup.length) return { setup, email: u.email };
  return { id: u.id, email: u.email, name: u.name };
}

/** For platform API routes: the admin, or an HttpError (404 for everyone who isn't one). */
export async function requirePlatformApi() {
  const a = await platformAdmin();
  if (!a) throw new HttpError(404, 'Not found');
  if ('setup' in a) throw new HttpError(403, `Finish setting up first: ${a.setup.join(' ')}`);
  return a;
}

// ---------- accounts ----------

const DAY = 864e5;
export const FILTERS = {
  all: 'All',
  trial: 'On trial',
  ending: 'Trial ends in 3 days or less',
  expired: 'Trial ended, no plan',
  paying: 'Paying',
  past_due: 'Past due',
  cancelled: 'Cancelled',
  complimentary: 'Complimentary',
  inactive: 'Not used in 14 days',
} as const;
export type Filter = keyof typeof FILTERS;
export const isFilter = (f: unknown): f is Filter => typeof f === 'string' && f in FILTERS;

type OrgRow = Pick<Organization, 'subscriptionStatus' | 'trialEndsAt' | 'complimentary'>;
export const daysLeft = (o: Pick<Organization, 'trialEndsAt'>, now = new Date()) => (o.trialEndsAt ? Math.ceil((o.trialEndsAt.getTime() - now.getTime()) / DAY) : null);
/** One plain label for where a company stands. */
export function standing(o: OrgRow, now = new Date()) {
  if (o.complimentary) return { key: 'complimentary', label: 'Complimentary' };
  const s = o.subscriptionStatus;
  if (s === 'trial_expired') return { key: 'expired', label: 'Trial ended' };
  if (s === 'trialing') { const d = daysLeft(o, now); return { key: 'trial', label: d === null ? 'Trial' : d > 0 ? `Trial · ${d} day${d === 1 ? '' : 's'} left` : 'Trial ends today' }; }
  if (s === 'active') return { key: 'paying', label: 'Paying' };
  if (s === 'past_due' || s === 'unpaid') return { key: 'past_due', label: 'Past due' };
  if (s === 'canceled' || s === 'incomplete_expired') return { key: 'cancelled', label: 'Cancelled' };
  return { key: s, label: s.replace(/_/g, ' ') };
}

export async function accounts(opts: { filter?: Filter; q?: string } = {}, now = new Date()) {
  const q = opts.q?.trim();
  const orgs = await db.organization.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }, { members: { some: { user: { email: { contains: q, mode: 'insensitive' } } } } }] } : {},
    orderBy: { createdAt: 'desc' }, take: 2000,
    include: { _count: { select: { members: true } }, members: { where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' }, take: 1, select: { user: { select: { name: true, email: true } } } } },
  });
  const ids = orgs.map((o) => o.id);
  const [emp, act] = ids.length ? await Promise.all([
    db.employee.groupBy({ by: ['organizationId'], where: { organizationId: { in: ids }, status: { not: 'TERMINATED' } }, _count: { _all: true } }),
    db.activity.groupBy({ by: ['organizationId'], where: { organizationId: { in: ids } }, _max: { createdAt: true } }),
  ]) : [[], []];
  const empOf = new Map(emp.map((e) => [e.organizationId, e._count._all]));
  const lastOf = new Map(act.map((a) => [a.organizationId, a._max.createdAt]));
  const rows = orgs.map((o) => {
    const st = standing(o, now);
    const last = [lastOf.get(o.id), o.createdAt].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0]!;
    return {
      id: o.id, name: o.name, slug: o.slug, kind: o.kind, industry: o.industry, plan: o.plan, planName: planView(o.plan, o.kind).name,
      status: o.subscriptionStatus, standing: st.key, standingLabel: st.label, trialEndsAt: o.trialEndsAt, daysLeft: daysLeft(o, now),
      owner: o.members[0]?.user ?? null, users: o._count.members, employees: empOf.get(o.id) ?? 0, created: o.createdAt, lastActive: last,
      stripe: !!o.stripeSubscriptionId, complimentary: o.complimentary,
    };
  });
  const f = opts.filter ?? 'all';
  return rows.filter((r) => inFilter(r, f, now));
}
export type AccountRow = Awaited<ReturnType<typeof accounts>>[number];

/** Whether an account belongs under a filter tab. */
export function inFilter(r: { standing: string; daysLeft: number | null; lastActive: Date }, f: Filter, now = new Date()) {
  switch (f) {
    case 'all': return true;
    case 'trial': return r.standing === 'trial';
    case 'ending': return r.standing === 'trial' && r.daysLeft !== null && r.daysLeft <= 3;
    case 'inactive': return now.getTime() - r.lastActive.getTime() > 14 * DAY;
    default: return r.standing === f;
  }
}

let mrrCache: { at: number; cents: number | null } | null = null;
/** Monthly recurring revenue from Stripe's active subscriptions (cached 10 minutes); null without Stripe. */
async function stripeMrr() {
  if (!stripeEnabled()) return null;
  if (mrrCache && Date.now() - mrrCache.at < 600e3) return mrrCache.cents;
  try {
    let cents = 0;
    for await (const sub of stripe.subscriptions.list({ status: 'active', limit: 100, expand: ['data.items.data.price'] })) {
      for (const it of sub.items.data) {
        const p = it.price, amt = (p.unit_amount ?? 0) * (it.quantity ?? 1);
        const per = p.recurring?.interval === 'year' ? 12 : p.recurring?.interval === 'week' ? 12 / 52 : p.recurring?.interval === 'day' ? 12 / 365 : 1;
        cents += amt / per / (p.recurring?.interval_count ?? 1);
      }
    }
    mrrCache = { at: Date.now(), cents: Math.round(cents) };
    return mrrCache.cents;
  } catch { return null; }
}

export async function metrics(now = new Date()) {
  const all = await db.organization.findMany({ select: { createdAt: true, subscriptionStatus: true, trialEndsAt: true, stripeSubscriptionId: true, complimentary: true } });
  const since = (days: number) => all.filter((o) => now.getTime() - o.createdAt.getTime() < days * DAY).length;
  const st = all.map((o) => standing(o, now).key);
  const count = (k: string) => st.filter((x) => x === k).length;
  // Conversion: companies that signed up 15–105 days ago (their trial is over), not complimentary; how many have a plan.
  const cohort = all.filter((o) => !o.complimentary && now.getTime() - o.createdAt.getTime() >= 15 * DAY && now.getTime() - o.createdAt.getTime() <= 105 * DAY);
  const converted = cohort.filter((o) => !!o.stripeSubscriptionId && ['active', 'past_due', 'trialing'].includes(o.subscriptionStatus)).length;
  return {
    total: all.length, week: since(7), month: since(30), trials: count('trial'), ending: all.filter((o) => standing(o, now).key === 'trial' && (daysLeft(o, now) ?? 99) <= 3).length,
    expired: count('expired'), paying: count('paying'), pastDue: count('past_due'), complimentary: count('complimentary'),
    conversion: cohort.length ? { rate: converted / cohort.length, of: cohort.length } : null, mrrCents: await stripeMrr(),
  };
}

export const accountsCsv = (rows: AccountRow[]) => {
  const cell = (v: unknown) => { const s = v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };
  const head = ['Company', 'Type', 'Industry', 'Plan', 'Standing', 'Trial ends', 'Owner', 'Owner email', 'Users', 'Employees', 'Signed up', 'Last active', 'Stripe subscription'];
  return [head.join(','), ...rows.map((r) => [r.name, r.kind === 'EMPLOYER' ? 'Employer' : 'Staffing', r.industry, r.planName, r.standingLabel, r.trialEndsAt, r.owner?.name, r.owner?.email, r.users, r.employees, r.created, r.lastActive, r.stripe ? 'yes' : 'no'].map(cell).join(','))].join('\n');
};
