// Single sign-on (Enterprise) through WorkOS (https://workos.com/docs/sso). Each company gets a WorkOS organization;
// its IT team connects their identity provider in WorkOS's setup portal. Sign-in finds the company by email domain,
// and only lets in people who are already members of that company here (invited as usual). On when WORKOS_API_KEY
// and WORKOS_CLIENT_ID are set.
import type { Organization, User } from '@prisma/client';
import { db } from './db';
import { HttpError, logActivity, tenantDb, type TenantDb } from './tenant';
import { audit } from './audit';
import { readState, signState } from './secret-box';
import { issueToken } from './account';

export const ssoEnabled = () => !!process.env.WORKOS_API_KEY?.trim() && !!process.env.WORKOS_CLIENT_ID?.trim();
const base = () => process.env.WORKOS_API_BASE ?? 'https://api.workos.com';
const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';
export const CALLBACK_PATH = '/api/auth/sso/callback';
const NOT_SET_UP = 'Single sign-on isn’t available on this server yet (WORKOS_API_KEY and WORKOS_CLIENT_ID).';

async function workos<T>(path: string, init: { method?: string; body?: object | URLSearchParams } = {}): Promise<T> {
  if (!ssoEnabled()) throw new HttpError(503, NOT_SET_UP);
  const form = init.body instanceof URLSearchParams;
  const r = await fetch(`${base()}${path}`, {
    method: init.method ?? 'GET', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${process.env.WORKOS_API_KEY}`, 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
    body: init.body ? (form ? init.body as URLSearchParams : JSON.stringify(init.body)) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, `WorkOS said: ${(j as { message?: string; error_description?: string }).message ?? (j as { error_description?: string }).error_description ?? `HTTP ${r.status}`}`);
  return j as T;
}

// Webmail and consumer domains can't be claimed: anyone can have an address there.
const PUBLIC_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.net', 'mail.com', 'yandex.com', 'zoho.com', 'fastmail.com', 'hey.com', 'example.com']);
export const domainOf = (email: string) => email.trim().toLowerCase().split('@')[1] ?? '';
export const cleanDomain = (d: string) => d.trim().toLowerCase().replace(/^@/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Domains a company may claim: real company domains (not webmail), each used by at least one of its current members,
 * and not claimed by another company here. Pure checks first, then the database ones.
 */
export async function checkDomains(orgId: string, raw: string[]) {
  const domains = [...new Set(raw.map(cleanDomain).filter(Boolean))];
  if (!domains.length) throw new HttpError(400, 'Add your company’s email domain, like yourcompany.com.');
  if (domains.length > 10) throw new HttpError(400, 'Up to 10 domains.');
  for (const d of domains) {
    if (!DOMAIN_RE.test(d)) throw new HttpError(400, `“${d}” isn’t a domain. Use the part after @ in your work email, like yourcompany.com.`);
    if (PUBLIC_DOMAINS.has(d)) throw new HttpError(400, `${d} is a public email service, so it can’t be used for single sign-on. Use your company’s own domain.`);
  }
  const members = await db.membership.findMany({ where: { organizationId: orgId }, select: { user: { select: { email: true } } } });
  const used = new Set(members.map((m) => domainOf(m.user.email)));
  const unused = domains.filter((d) => !used.has(d));
  if (unused.length) throw new HttpError(400, `Nobody on your team has an @${unused[0]} email yet. Invite someone with that address first, then add the domain.`);
  const taken = await db.ssoConnection.findFirst({ where: { organizationId: { not: orgId }, domains: { hasSome: domains } }, select: { domains: true } });
  if (taken) throw new HttpError(409, `${domains.find((d) => taken.domains.includes(d))} is already used for single sign-on by another company.`);
  return domains;
}

type WorkosOrg = { id: string };
type Connection = { id: string; state: string; connection_type?: string; organization_id?: string };

export async function ssoStatus(tdb: TenantDb, org: { ssoRequired: boolean }) {
  if (!ssoEnabled()) return { state: 'off' as const };
  const c = await tdb.ssoConnection.findFirst();
  if (!c) return { state: 'none' as const };
  return { state: c.state === 'active' ? ('active' as const) : ('draft' as const), domains: c.domains, connectionType: c.connectionType, required: org.ssoRequired };
}

/** Creates (or updates) the company's WorkOS organization with its email domains. */
export async function setupSso(org: Organization, user: User, rawDomains: string[]) {
  const domains = await checkDomains(org.id, rawDomains);
  const tdb = tenantDb(org.id);
  const existing = await tdb.ssoConnection.findFirst();
  const domain_data = domains.map((domain) => ({ domain, state: 'pending' }));
  if (existing) {
    await workos(`/organizations/${encodeURIComponent(existing.workosOrgId)}`, { method: 'PUT', body: { name: org.name, domain_data } });
    await tdb.ssoConnection.updateMany({ data: { domains } });
  } else {
    const w = await workos<WorkosOrg>('/organizations', { method: 'POST', body: { name: org.name, domain_data, external_id: org.id } });
    await tdb.ssoConnection.create({ data: { workosOrgId: w.id, domains, createdById: user.id } as never });
  }
  await logActivity(org.id, `Set up single sign-on for ${domains.join(', ')}`, user.id);
  await audit(org.id, user, 'settings.sso', `${existing ? 'Changed' : 'Started'} single sign-on for ${domains.join(', ')}`);
  return domains;
}

/** A one-time link to WorkOS's setup portal, where the company's IT team connects their identity provider. */
export async function portalLink(tdb: TenantDb) {
  const c = await tdb.ssoConnection.findFirst();
  if (!c) throw new HttpError(409, 'Add your email domain first.');
  const r = await workos<{ link?: string }>('/portal/generate_link', { method: 'POST', body: { organization: c.workosOrgId, intent: 'sso', return_url: `${appUrl()}/app/settings?sso=back#sso` } });
  if (!r.link) throw new HttpError(502, 'WorkOS didn’t return a setup link. Try again in a minute.');
  return r.link;
}

/** Reads the connection's state from WorkOS (draft until IT finishes and tests it, then active). */
export async function refreshSso(tdb: TenantDb) {
  const c = await tdb.ssoConnection.findFirst();
  if (!c) return null;
  const r = await workos<{ data: Connection[] }>(`/connections?organization_id=${encodeURIComponent(c.workosOrgId)}`);
  const live = r.data.find((x) => x.state === 'active') ?? r.data[0];
  const state = live?.state === 'active' ? 'active' : 'draft';
  await tdb.ssoConnection.updateMany({ data: { state, connectionType: live?.connection_type ?? null } });
  // Nobody can be made to sign in through a connection that doesn't work.
  if (state !== 'active') await db.organization.updateMany({ where: { id: c.organizationId, ssoRequired: true }, data: { ssoRequired: false } });
  return state;
}

export async function setRequired(org: Organization, user: User, required: boolean) {
  const tdb = tenantDb(org.id);
  if (required && (await refreshSso(tdb)) !== 'active') throw new HttpError(409, 'Finish connecting your identity provider first. Single sign-on has to be working before you can require it.');
  await db.organization.update({ where: { id: org.id }, data: { ssoRequired: required } });
  await logActivity(org.id, required ? 'Required single sign-on for the team' : 'Stopped requiring single sign-on', user.id);
  await audit(org.id, user, 'settings.sso', required ? 'Required single sign-on for everyone (owners keep their password as a backup)' : 'Stopped requiring single sign-on', { changes: { ssoRequired: [org.ssoRequired, required] } });
}

export async function turnOff(org: Organization, user: User) {
  const tdb = tenantDb(org.id);
  const c = await tdb.ssoConnection.findFirst();
  if (!c) return;
  await workos(`/organizations/${encodeURIComponent(c.workosOrgId)}`, { method: 'DELETE' }).catch((e) => { if (!(e instanceof HttpError && e.status === 404)) throw e; });
  await tdb.ssoConnection.deleteMany({});
  await db.organization.update({ where: { id: org.id }, data: { ssoRequired: false } });
  await logActivity(org.id, 'Turned off single sign-on', user.id);
  await audit(org.id, user, 'settings.sso', `Turned off single sign-on for ${c.domains.join(', ')}`);
}

/** "Sign in with SSO": WorkOS's sign-in URL for the company that uses this email's domain, or null. */
export async function startLogin(email: string) {
  if (!ssoEnabled()) return null;
  const domain = domainOf(email);
  if (!domain) return null;
  const c = await db.ssoConnection.findFirst({ where: { domains: { has: domain }, state: 'active' } });
  if (!c) return null;
  const q = new URLSearchParams({
    client_id: process.env.WORKOS_CLIENT_ID!, redirect_uri: `${appUrl()}${CALLBACK_PATH}`, response_type: 'code',
    organization: c.workosOrgId, login_hint: email.trim().toLowerCase(), state: signState({ o: c.organizationId, w: c.workosOrgId }),
  });
  return `${base()}/sso/authorize?${q}`;
}

type Profile = { email: string; organization_id: string | null; connection_id: string; first_name?: string | null; last_name?: string | null };

/**
 * WorkOS's redirect back: exchanges the code for the person's profile, checks it came from this company's own
 * connection and that they're already a member, and returns a one-time ticket the browser trades for a session.
 */
export async function finishLogin(code: string, rawState: string | null) {
  const st = readState(rawState);
  if (!st?.o || !st?.w) throw new HttpError(400, 'That sign-in link expired. Start again.');
  const r = await workos<{ profile: Profile }>('/sso/token', { method: 'POST', body: new URLSearchParams({ client_id: process.env.WORKOS_CLIENT_ID!, client_secret: process.env.WORKOS_API_KEY!, grant_type: 'authorization_code', code }) });
  const p = r.profile;
  const conn = await db.ssoConnection.findUnique({ where: { workosOrgId: st.w } });
  if (!conn || conn.organizationId !== st.o || p.organization_id !== conn.workosOrgId || conn.state !== 'active') throw new HttpError(403, 'Single sign-on isn’t set up for that company anymore. Sign in with your password or ask your admin.');
  const email = p.email?.trim().toLowerCase();
  // The identity provider vouches for addresses on the company's own domains only.
  if (!email || !conn.domains.includes(domainOf(email))) throw new HttpError(403, `Your identity provider signed you in as ${email || 'an unknown address'}, which isn’t on your company’s single sign-on domains.`);
  const user = await db.user.findUnique({ where: { email }, include: { memberships: { where: { organizationId: conn.organizationId } } } });
  if (!user || !user.memberships.length) throw new HttpError(403, `There’s no Preciops account for ${email} at this company yet. Ask an admin to invite you.`);
  const ticket = await issueToken(user.id, 'sso');
  return { ticket: signState({ t: ticket, o: conn.organizationId }, 2 * 60e3) };
}

