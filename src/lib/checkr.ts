import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import type { Organization, User } from '@prisma/client';
import { db } from './db';
import { HttpError, logActivity, tenantDb, type TenantDb } from './tenant';
import { audit } from './audit';
import { open, seal } from './secret-box';

/**
 * Background checks through Checkr's partner program (https://github.com/checkr/oauth-docs). Each company connects its
 * own Checkr account (sign in, or create one) and orders under it: Checkr has to credential every employer for an FCRA
 * permissible purpose, so one shared account for all companies isn't allowed. On when CHECKR_CLIENT_ID and
 * CHECKR_CLIENT_SECRET (from registering as a Checkr partner) are set; CHECKR_ENV=production uses the live API.
 * We send only name, email and work location: the candidate enters SSN, date of birth and FCRA consent on Checkr's
 * own invitation page.
 */
export const checkrEnabled = () => !!process.env.CHECKR_CLIENT_ID?.trim() && !!process.env.CHECKR_CLIENT_SECRET?.trim();
const apiRoot = () => process.env.CHECKR_API_BASE ?? (process.env.CHECKR_ENV === 'production' ? 'https://api.checkr.com' : 'https://api.checkr-staging.com');
const partnersRoot = () => process.env.CHECKR_PARTNERS_URL ?? 'https://partners.checkr.com';
export const dashboardUrl = () => (process.env.CHECKR_ENV === 'production' ? 'https://dashboard.checkr.com' : 'https://dashboard.checkr-staging.com');
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

const NOT_SET_UP = 'Background checks aren’t set up on this server yet (CHECKR_CLIENT_ID and CHECKR_CLIENT_SECRET).';

async function call<T>(token: string, path: string, init: { method?: string; body?: object } = {}): Promise<T> {
  const r = await fetch(`${apiRoot()}/v1${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}`, 'Content-Type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, `Checkr said: ${(j as { error?: string }).error ?? `HTTP ${r.status}`}`);
  return j as T;
}

/** Where "Connect" sends an admin: Checkr's sign-in (existing account) or sign-up (new account). */
export function authorizeUrl(state: string, mode: 'signin' | 'signup') {
  if (!checkrEnabled()) throw new HttpError(503, NOT_SET_UP);
  return `${partnersRoot()}/authorize/${encodeURIComponent(process.env.CHECKR_CLIENT_ID!)}/${mode}?scope=read_write&state=${encodeURIComponent(state)}`;
}

type Account = { id?: string; name?: string; authorized?: boolean; api_authorized?: boolean };
const credentialed = (a: Account) => a.authorized === true || a.api_authorized === true;

/** The company's connection, with its token. */
export async function connection(tdb: TenantDb) {
  const c = await tdb.checkrConnection.findFirst();
  return c ? { ...c, token: open(c.accessTokenEnc) } : null;
}

/** Turns the code from Checkr's redirect into the company's access token and saves the connection. */
export async function connectAccount(org: Organization, user: User, code: string) {
  if (!checkrEnabled()) throw new HttpError(503, NOT_SET_UP);
  const r = await fetch(`${apiRoot()}/oauth/tokens`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ client_id: process.env.CHECKR_CLIENT_ID!, client_secret: process.env.CHECKR_CLIENT_SECRET!, code }),
  });
  const t = (await r.json().catch(() => ({}))) as { access_token?: string; checkr_account_id?: string; error?: string };
  if (!r.ok || !t.access_token || !t.checkr_account_id) throw new HttpError(502, `Checkr didn’t connect: ${t.error ?? `HTTP ${r.status}`}. Start again from Settings.`);
  // Webhooks name the Checkr account, so one account can only belong to one company here.
  const taken = await db.checkrConnection.findFirst({ where: { accountId: t.checkr_account_id, organizationId: { not: org.id } } });
  if (taken) throw new HttpError(409, 'That Checkr account is already connected to another company. Each company needs its own Checkr account.');
  const acct = await call<Account>(t.access_token, '/account').catch(() => ({} as Account));
  const tdb = tenantDb(org.id);
  const data = { accountId: t.checkr_account_id, accountName: acct.name ?? null, accessTokenEnc: seal(t.access_token), tokenHash: hashToken(t.access_token), credentialedAt: credentialed(acct) ? new Date() : null, connectedById: user.id, connectedAt: new Date() };
  if (await tdb.checkrConnection.count()) await tdb.checkrConnection.updateMany({ data });
  else await tdb.checkrConnection.create({ data: data as never });
  await logActivity(org.id, `Connected the company’s Checkr account${acct.name ? ` (${acct.name})` : ''}`, user.id);
  await audit(org.id, user, 'settings.screening', `Connected Checkr account ${acct.name ?? t.checkr_account_id}${data.credentialedAt ? '' : '; waiting for Checkr to approve it'}`);
  return { credentialed: !!data.credentialedAt };
}

/** Asks Checkr again whether the account is approved (the webhook normally tells us). */
export async function refreshAccount(tdb: TenantDb) {
  const c = await connection(tdb);
  if (!c) return null;
  const acct = await call<Account>(c.token, '/account');
  const ok = credentialed(acct);
  await tdb.checkrConnection.updateMany({ data: { accountName: acct.name ?? c.accountName, credentialedAt: ok ? (c.credentialedAt ?? new Date()) : null } });
  return ok;
}

export async function disconnect(org: Organization, user: User) {
  const tdb = tenantDb(org.id);
  const c = await connection(tdb);
  if (!c) return;
  // Tell Checkr too, so the token stops working; the account itself (and its reports) stays the company's.
  await fetch(`${apiRoot()}/oauth/deauthorize`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${c.token}:`).toString('base64')}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  await tdb.checkrConnection.deleteMany({});
  await logActivity(org.id, 'Disconnected the company’s Checkr account', user.id);
  await audit(org.id, user, 'settings.screening', `Disconnected Checkr account ${c.accountName ?? c.accountId}`);
}

/** Where this company stands, for Settings and the candidate drawer. */
export async function screeningStatus(tdb: TenantDb) {
  if (!checkrEnabled()) return { state: 'off' as const };
  const c = await tdb.checkrConnection.findFirst({ select: { accountName: true, credentialedAt: true, connectedAt: true } });
  if (!c) return { state: 'not_connected' as const };
  return { state: c.credentialedAt ? ('ready' as const) : ('pending' as const), accountName: c.accountName, connectedAt: c.connectedAt.toISOString() };
}

/** The company's token, once Checkr has approved the account; otherwise a message saying what to do. */
async function readyToken(tdb: TenantDb) {
  if (!checkrEnabled()) throw new HttpError(503, NOT_SET_UP);
  const c = await connection(tdb);
  if (!c) throw new HttpError(409, 'Connect your company’s Checkr account first (an admin does it in Settings & data).');
  if (!c.credentialedAt) throw new HttpError(409, 'Checkr is still approving your company’s account. That usually takes up to one business day, and Checkr emails you when it’s done.');
  return c.token;
}

export async function packages(tdb: TenantDb) {
  const r = await call<{ data: { slug: string; name: string }[] }>(await readyToken(tdb), '/packages');
  return r.data.map((p) => ({ slug: p.slug, name: p.name }));
}

export const OrderBody = z.object({
  candidateId: z.string(),
  package: z.string().min(1, 'Choose a package.').max(100),
  state: z.string().regex(/^[A-Z]{2}$/, 'Choose the state where they’ll work.'),
  city: z.string().trim().max(80).optional(),
});

/** Creates the Checkr candidate and invitation in the company's own account. Checkr emails the candidate a link to consent. */
export async function orderCheck(org: Organization, user: User, b: z.infer<typeof OrderBody>) {
  const tdb = tenantDb(org.id);
  const token = await readyToken(tdb);
  const c = await tdb.candidate.findFirst({ where: { id: b.candidateId } });
  if (!c) throw new HttpError(404, 'That candidate was deleted.');
  if (!c.email) throw new HttpError(400, `Add ${c.name}’s email first — Checkr sends them the consent form.`);
  const open = await tdb.backgroundCheck.findFirst({ where: { candidateId: c.id, status: { in: ['invited', 'pending'] } } });
  if (open) throw new HttpError(409, `${c.name} already has a background check in progress.`);
  const [first, ...rest] = c.name.trim().split(/\s+/);
  const cand = await call<{ id: string }>(token, '/candidates', { method: 'POST', body: { first_name: first, last_name: rest.join(' ') || first, email: c.email, custom_id: c.id } });
  const inv = await call<{ id: string; invitation_url?: string }>(token, '/invitations', { method: 'POST', body: {
    candidate_id: cand.id, package: b.package, work_locations: [{ country: 'US', state: b.state, ...(b.city ? { city: b.city } : {}) }],
  } });
  const bc = await tdb.backgroundCheck.create({ data: { candidateId: c.id, package: b.package, externalCandidateId: cand.id, externalInvitationId: inv.id, invitationUrl: inv.invitation_url ?? null, orderedById: user.id } as never });
  await logActivity(org.id, `Ordered a ${b.package} background check for ${c.name}`, user.id);
  await audit(org.id, user, 'screening.order', `Ordered a Checkr ${b.package} background check for ${c.name}`, { targetType: 'candidate', targetId: c.id });
  return bc;
}

/**
 * Checkr signs partner webhooks with an HMAC-SHA256 of the raw body (header X-Checkr-Signature). Its partner guide
 * names the client ID as the key; the client secret is accepted too. The signature only filters noise: nothing in a
 * webhook is trusted on its own (see applyEvent).
 */
export function verifySignature(raw: string, signature: string | null) {
  if (!signature || !checkrEnabled()) return false;
  const got = Buffer.from(signature.trim());
  return [process.env.CHECKR_CLIENT_ID!, process.env.CHECKR_CLIENT_SECRET!].some((key) => {
    const want = Buffer.from(createHmac('sha256', key).update(raw).digest('hex'));
    return want.length === got.length && timingSafeEqual(want, got);
  });
}

type Hook = { type: string; account_id?: string; data: { object: { id?: string; access_code?: string } } };
type Invitation = { id: string; status?: string; report_id?: string | null };
type Report = { id: string; status?: string; result?: string | null; candidate_id?: string };

/** Report status from Checkr's own copy of the report. */
function reportStatus(r: Report) {
  if (r.status === 'complete') return r.result === 'clear' ? 'clear' : 'consider';
  return ({ pending: 'pending', suspended: 'suspended', dispute: 'dispute', canceled: 'canceled' } as Record<string, string>)[r.status ?? ''] ?? null;
}

/**
 * Applies a Checkr webhook. It only says which company and which record to look at: the status itself is read back
 * from Checkr with that company's own token, so a forged or replayed webhook can't change anything.
 * Returns what changed, or null if the event isn't about anything we track.
 */
export async function applyEvent(ev: Hook) {
  const o = ev.data?.object ?? {};
  if (ev.type === 'token.deauthorized') {
    if (!o.access_code) return null;
    const c = await db.checkrConnection.findUnique({ where: { tokenHash: hashToken(o.access_code) } });
    if (!c) return null;
    await tenantDb(c.organizationId).checkrConnection.deleteMany({});
    await logActivity(c.organizationId, 'Your Checkr account was disconnected from Preciops (in Checkr). Connect it again in Settings & data to order checks.');
    return { id: c.id, status: 'disconnected' };
  }
  const accountId = ev.type === 'account.credentialed' ? o.id : ev.account_id;
  if (!accountId) return null;
  const conn = await db.checkrConnection.findUnique({ where: { accountId } });
  if (!conn) return null;
  const tdb = tenantDb(conn.organizationId);
  const token = open(conn.accessTokenEnc);

  if (ev.type === 'account.credentialed') {
    const ok = await refreshAccount(tdb);
    if (ok && !conn.credentialedAt) await logActivity(conn.organizationId, 'Checkr approved your company’s account. You can order background checks now.');
    return { id: conn.id, status: ok ? 'credentialed' : 'pending' };
  }
  if (!o.id) return null;

  let bc, status: string | null = null;
  const data: Record<string, unknown> = {};
  if (ev.type.startsWith('invitation.')) {
    bc = await tdb.backgroundCheck.findFirst({ where: { externalInvitationId: o.id } });
    if (!bc) return null;
    const inv = await call<Invitation>(token, `/invitations/${encodeURIComponent(o.id)}`).catch((e) => { if (e instanceof HttpError && e.status === 404) return null; throw e; });
    if (!inv) status = 'canceled';
    else if (inv.status === 'completed') { status = 'pending'; if (inv.report_id) data.externalReportId = inv.report_id; }
    else if (inv.status === 'expired') status = 'expired';
  } else if (ev.type.startsWith('report.')) {
    // Not this company's report (Checkr won't show it to their token): nothing to do, and no reason for Checkr to retry.
    const rep = await call<Report>(token, `/reports/${encodeURIComponent(o.id)}`).catch((e) => { if (e instanceof HttpError && e.status === 404) return null; throw e; });
    if (!rep) return null;
    bc = await tdb.backgroundCheck.findFirst({ where: { externalReportId: rep.id } })
      ?? (rep.candidate_id ? await tdb.backgroundCheck.findFirst({ where: { externalCandidateId: rep.candidate_id, externalReportId: null }, orderBy: { orderedAt: 'desc' } }) : null);
    if (!bc) return null;
    status = reportStatus(rep);
    data.externalReportId = rep.id;
    if (status === 'clear' || status === 'consider') data.completedAt = bc.completedAt ?? new Date();
  }
  if (!bc || !status) return null;
  const was = bc.status;
  await tdb.backgroundCheck.updateMany({ where: { id: bc.id }, data: { ...data, status } });
  if (status === was) return { id: bc.id, status }; // Checkr resends events; act once
  const c = await tdb.candidate.findFirst({ where: { id: bc.candidateId }, select: { id: true, name: true } });
  if (c && status === 'clear') {
    // A clear report counts as a verified background-check credential for a year.
    const expires = new Date(); expires.setUTCFullYear(expires.getUTCFullYear() + 1);
    await tdb.credential.create({ data: { candidateId: c.id, type: 'Background check', issuedAt: new Date(), expiresAt: expires, verifiedAt: new Date(), verifyMethod: 'Checkr report', verifyNote: `Checkr report ${data.externalReportId} (${bc.package}): clear` } as never });
  }
  if (c) await logActivity(conn.organizationId, status === 'consider'
    ? `${c.name}’s background check needs review (“consider”). Review the report in Checkr and follow the FCRA adverse-action steps before deciding.`
    : `${c.name}’s background check is ${status === 'pending' ? 'in progress' : STATUS_LABEL[status]?.toLowerCase() ?? status}`);
  return { id: bc.id, status };
}

export const STATUS_LABEL: Record<string, string> = { invited: 'Waiting for candidate', pending: 'In progress', clear: 'Clear', consider: 'Needs review', suspended: 'Suspended', canceled: 'Canceled', dispute: 'Disputed', expired: 'Invitation expired' };
