import { z } from 'zod';
import type { Credential } from '@prisma/client';
import { db } from './db';
import { HttpError, tenantDb } from './tenant';
import { hasFeature } from './plans';
import { sendEmail } from './email';
import { CREDENTIAL_TYPE_NAMES, alertDue, credentialLabel, credentialStatus, typeSpec } from './credentials';

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const date = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.'), z.null()]).optional()
  .refine((v) => !v || !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Enter a valid date.');
const text = (max: number, label: string) => z.union([z.string().max(max, `${label} is too long.`), z.null()]).optional().transform((v) => (v?.trim() ? v.trim() : v === undefined ? undefined : null));

export const CredentialBody = z.object({
  type: z.string().refine((t) => CREDENTIAL_TYPE_NAMES.includes(t), 'Choose a credential type.'),
  name: text(120, 'Name'),
  number: text(60, 'Number'),
  state: z.union([z.string(), z.null()]).optional().transform((v, ctx) => {
    if (v === undefined) return undefined;
    const s = v?.trim().toUpperCase() ?? '';
    if (!s) return null;
    if (!/^[A-Z]{2}$/.test(s)) { ctx.addIssue({ code: 'custom', message: 'Use the two-letter state code, like TX.' }); return z.NEVER; }
    return s;
  }),
  issuedAt: date, expiresAt: date,
  notes: text(2000, 'Notes'),
}, { invalid_type_error: 'Invalid input' }).strip();
export type CredentialInput = z.infer<typeof CredentialBody>;

export function parseCredential(body: unknown, mode: 'create' | 'update') {
  const res = (mode === 'create' ? CredentialBody : CredentialBody.partial()).safeParse(body ?? {});
  if (!res.success) throw new HttpError(400, res.error.issues[0]?.message ?? 'Invalid input');
  const v = res.data;
  if (v.issuedAt && v.expiresAt && v.expiresAt < v.issuedAt) throw new HttpError(400, 'The expiration date is before the issue date.');
  if (v.type === 'Other' && mode === 'create' && !v.name) throw new HttpError(400, 'Name the credential.');
  if (v.type === 'NPI' && v.number && !validNpi(v.number)) throw new HttpError(400, 'That isn’t a valid 10-digit NPI.');
  const data: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) if (x !== undefined) data[k] = (k === 'issuedAt' || k === 'expiresAt') && x ? new Date(`${x}T00:00:00Z`) : x;
  return data;
}

/** Fields that, when changed, mean the credential must be verified again. */
export const IDENTITY_FIELDS = ['type', 'number', 'state', 'issuedAt', 'expiresAt'] as const;

export function credentialJson(c: Credential, verifier?: string | null) {
  const v = { type: c.type, number: c.number, state: c.state, expiresAt: ymd(c.expiresAt), verifiedAt: c.verifiedAt?.toISOString() ?? null };
  return {
    id: c.id, candidateId: c.candidateId, type: c.type, name: c.name, number: c.number, state: c.state, issuedAt: ymd(c.issuedAt), expiresAt: v.expiresAt,
    verifiedAt: v.verifiedAt, verifiedBy: verifier ?? null, verifyMethod: c.verifyMethod, verifyNote: c.verifyNote, hasFile: !!c.fileId, notes: c.notes,
    label: credentialLabel(c), status: credentialStatus(v),
  };
}
export type CredentialJson = ReturnType<typeof credentialJson>;

/** Names of the people who verified these credentials (members of this org only). */
export async function verifierNames(orgId: string, creds: { verifiedById: string | null }[]) {
  const ids = [...new Set(creds.map((c) => c.verifiedById).filter(Boolean))] as string[];
  if (!ids.length) return new Map<string, string>();
  const ms = await db.membership.findMany({ where: { organizationId: orgId, userId: { in: ids } }, select: { user: { select: { id: true, name: true, email: true } } } });
  return new Map(ms.map((m) => [m.user.id, m.user.name || m.user.email]));
}

// ---- NPI (NPPES) ----
/** NPI check digit: Luhn over "80840" + the first nine digits. */
export function validNpi(n: string) {
  if (!/^\d{10}$/.test(n)) return false;
  const digits = `80840${n.slice(0, 9)}`.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits[digits.length - 1 - i];
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(n[9]);
}

type NppesResult = {
  number: string; enumeration_type: string;
  basic?: { first_name?: string; last_name?: string; organization_name?: string; status?: string; credential?: string };
  taxonomies?: { desc?: string; primary?: boolean; state?: string; license?: string }[];
};
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

/**
 * Looks an NPI up in the public NPPES registry and checks it's active and belongs to someone with the candidate's last name.
 * Only the NPI number leaves the app.
 */
export async function lookupNpi(npi: string, candidateName: string, fetcher: typeof fetch = fetch) {
  let res: Response;
  try { res = await fetcher(`https://npiregistry.cms.hhs.gov/api/?version=2.1&number=${npi}`, { signal: AbortSignal.timeout(10_000) }); }
  catch { throw new HttpError(502, 'The NPI registry didn’t respond. Try again in a minute, or verify it manually.'); }
  if (!res.ok) throw new HttpError(502, 'The NPI registry didn’t respond. Try again in a minute, or verify it manually.');
  const body = await res.json().catch(() => null) as { result_count?: number; results?: NppesResult[] } | null;
  const r = body?.results?.[0];
  if (!r) return { found: false as const };
  const registered = r.basic?.organization_name ?? [r.basic?.first_name, r.basic?.last_name].filter(Boolean).join(' ');
  const last = norm(r.basic?.last_name ?? '');
  const nameMatches = !!last && norm(candidateName.split(/\s+/).filter(Boolean).slice(-1)[0] ?? '') === last;
  const active = (r.basic?.status ?? 'A') === 'A';
  const primary = r.taxonomies?.find((t) => t.primary) ?? r.taxonomies?.[0];
  return {
    found: true as const, individual: r.enumeration_type === 'NPI-1', registered, active, nameMatches,
    taxonomy: primary?.desc ?? null, licenseState: primary?.state ?? null, license: primary?.license ?? null,
  };
}

// ---- alerts ----
const INACTIVE = ['Inactive', 'Do not use'];

/** Credentials that crossed into a new alert window (60/30/7 days, expired) for one org. */
export async function dueCredentialAlerts(orgId: string, now = new Date()) {
  const horizon = new Date(now.getTime() + 61 * 864e5);
  const rows = await tenantDb(orgId).credential.findMany({
    where: { expiresAt: { not: null, lte: horizon }, candidate: { status: { notIn: INACTIVE } } },
    include: { candidate: { select: { id: true, name: true } } }, orderBy: { expiresAt: 'asc' },
  });
  return rows.flatMap((c) => {
    const w = alertDue({ expiresAt: ymd(c.expiresAt), alertedLevel: c.alertedLevel }, now);
    return w === null ? [] : [{ id: c.id, window: w, candidate: c.candidate.name, candidateId: c.candidate.id, label: credentialLabel(c), expiresAt: ymd(c.expiresAt)! }];
  });
}

export function alertEmail(company: string, items: Awaited<ReturnType<typeof dueCredentialAlerts>>, appUrl: string) {
  const expired = items.filter((i) => i.window === 0), soon = items.filter((i) => i.window > 0);
  const line = (i: (typeof items)[number]) => {
    const d = new Date(`${i.expiresAt}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    return `• ${i.candidate} — ${i.label}: ${i.window === 0 ? `expired ${d}` : `expires ${d}`}`;
  };
  const subject = expired.length
    ? `${expired.length} credential${expired.length === 1 ? ' has' : 's have'} expired${soon.length ? `, ${soon.length} expiring soon` : ''}`
    : `${soon.length} credential${soon.length === 1 ? '' : 's'} expiring soon`;
  const text = [
    `Credential alerts for ${company}`, '',
    ...(expired.length ? ['EXPIRED — don’t schedule these people until the credential is renewed and verified:', ...expired.map(line), ''] : []),
    ...(soon.length ? ['EXPIRING SOON — ask for the renewal now:', ...soon.map(line), ''] : []),
    `Review and verify: ${appUrl}/app/credentials`, '',
    'You get this email when a credential reaches 60, 30 or 7 days before expiring, and when it expires.',
  ].join('\n');
  return { subject, text };
}

/**
 * Sends each org's recruiters one digest of credentials that reached a new alert window, logs each email,
 * and records the window so the same credential isn't reported twice.
 */
export async function runCredentialAlerts(now = new Date(), appUrl = process.env.APP_URL ?? 'http://localhost:3000') {
  const orgs = await db.organization.findMany({ where: { subscriptionStatus: { in: ['trialing', 'active'] } }, select: { id: true, name: true, plan: true, subscriptionStatus: true } });
  let emails = 0, credentials = 0;
  for (const org of orgs) {
    if (!hasFeature(org, 'credentials')) continue;
    const items = await dueCredentialAlerts(org.id, now);
    if (!items.length) continue;
    const members = await db.membership.findMany({ where: { organizationId: org.id, role: { in: ['OWNER', 'ADMIN', 'RECRUITER'] } }, select: { user: { select: { id: true, email: true } } } });
    const { subject, text } = alertEmail(org.name, items, appUrl);
    const tdb = tenantDb(org.id);
    let delivered = false;
    for (const m of members) {
      let status = 'sent', providerId: string | null = null, error: string | null = null;
      try { providerId = (await sendEmail({ to: m.user.email, subject, text, fromName: org.name })).id; delivered = true; emails++; }
      catch (e) { status = 'failed'; error = (e as Error).message.slice(0, 500); }
      await tdb.message.create({ data: { channel: 'email', toAddress: m.user.email, subject, body: text, relatedType: 'credential_alert', status, providerId, error } as never });
    }
    // Only mark as alerted when someone actually got the email, so a mail outage retries tomorrow.
    if (delivered) {
      for (const w of [...new Set(items.map((i) => i.window))]) {
        await tdb.credential.updateMany({ where: { id: { in: items.filter((i) => i.window === w).map((i) => i.id) } }, data: { alertedLevel: w } });
      }
      credentials += items.length;
    }
  }
  return { emails, credentials };
}

export { typeSpec };
