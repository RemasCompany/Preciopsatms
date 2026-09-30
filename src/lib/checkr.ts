import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import type { Organization, User } from '@prisma/client';
import { db } from './db';
import { HttpError, logActivity, tenantDb } from './tenant';
import { audit } from './audit';

/**
 * Background checks through Checkr (https://docs.checkr.com). On when CHECKR_API_KEY is set; CHECKR_ENV=production
 * uses the live API, anything else the staging sandbox. We send only name, email and work location: the candidate
 * enters SSN, date of birth and FCRA consent on Checkr's own hosted invitation page.
 */
export const checkrEnabled = () => !!process.env.CHECKR_API_KEY?.trim();
const base = () => (process.env.CHECKR_ENV === 'production' ? 'https://api.checkr.com/v1' : 'https://api.checkr-staging.com/v1');

async function checkr<T>(path: string, init: { method?: string; body?: object } = {}): Promise<T> {
  if (!checkrEnabled()) throw new HttpError(503, 'Background checks aren’t set up on this server yet (CHECKR_API_KEY).');
  const r = await fetch(`${base()}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Basic ${Buffer.from(`${process.env.CHECKR_API_KEY}:`).toString('base64')}`, 'Content-Type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, `Checkr said: ${(j as { error?: string }).error ?? `HTTP ${r.status}`}`);
  return j as T;
}

export async function packages() {
  const r = await checkr<{ data: { slug: string; name: string }[] }>('/packages');
  return r.data.map((p) => ({ slug: p.slug, name: p.name }));
}

export const OrderBody = z.object({
  candidateId: z.string(),
  package: z.string().min(1, 'Choose a package.').max(100),
  state: z.string().regex(/^[A-Z]{2}$/, 'Choose the state where they’ll work.'),
  city: z.string().trim().max(80).optional(),
});

/** Creates the Checkr candidate and invitation. Checkr emails the candidate a link to consent and fill in their details. */
export async function orderCheck(org: Organization, user: User, b: z.infer<typeof OrderBody>) {
  const tdb = tenantDb(org.id);
  const c = await tdb.candidate.findFirst({ where: { id: b.candidateId } });
  if (!c) throw new HttpError(404, 'That candidate was deleted.');
  if (!c.email) throw new HttpError(400, `Add ${c.name}’s email first — Checkr sends them the consent form.`);
  const open = await tdb.backgroundCheck.findFirst({ where: { candidateId: c.id, status: { in: ['invited', 'pending'] } } });
  if (open) throw new HttpError(409, `${c.name} already has a background check in progress.`);
  const [first, ...rest] = c.name.trim().split(/\s+/);
  const cand = await checkr<{ id: string }>('/candidates', { method: 'POST', body: { first_name: first, last_name: rest.join(' ') || first, email: c.email, custom_id: c.id } });
  const inv = await checkr<{ id: string; invitation_url?: string }>('/invitations', { method: 'POST', body: {
    candidate_id: cand.id, package: b.package, work_locations: [{ country: 'US', state: b.state, ...(b.city ? { city: b.city } : {}) }],
  } });
  const bc = await tdb.backgroundCheck.create({ data: { candidateId: c.id, package: b.package, externalCandidateId: cand.id, externalInvitationId: inv.id, invitationUrl: inv.invitation_url ?? null, orderedById: user.id } as never });
  await logActivity(org.id, `Ordered a ${b.package} background check for ${c.name}`, user.id);
  await audit(org.id, user, 'screening.order', `Ordered a Checkr ${b.package} background check for ${c.name}`, { targetType: 'candidate', targetId: c.id });
  return bc;
}

/** Checkr signs webhooks with an HMAC-SHA256 of the raw body, keyed by the API key. */
export function verifySignature(raw: string, signature: string | null) {
  const key = process.env.CHECKR_API_KEY;
  if (!key || !signature) return false;
  const want = Buffer.from(createHmac('sha256', key).update(raw).digest('hex'));
  const got = Buffer.from(signature.trim());
  return want.length === got.length && timingSafeEqual(want, got);
}

type Hook = { type: string; data: { object: { id: string; candidate_id?: string; report_id?: string; status?: string; result?: string | null } } };
const REPORT_STATUS: Record<string, string> = { 'report.suspended': 'suspended', 'report.disputed': 'dispute', 'report.canceled': 'canceled', 'report.created': 'pending', 'report.resumed': 'pending' };

/** Applies a Checkr webhook event. Returns what changed, or null if the event isn't about a check we ordered. */
export async function applyEvent(ev: Hook) {
  const o = ev.data?.object;
  if (!o?.id) return null;
  let bc;
  if (ev.type.startsWith('invitation.')) bc = await db.backgroundCheck.findFirst({ where: { externalInvitationId: o.id } });
  else if (ev.type.startsWith('report.')) {
    bc = (await db.backgroundCheck.findUnique({ where: { externalReportId: o.id } }))
      ?? (o.candidate_id ? await db.backgroundCheck.findFirst({ where: { externalCandidateId: o.candidate_id, externalReportId: null }, orderBy: { orderedAt: 'desc' } }) : null);
  }
  if (!bc) return null;
  const tdb = tenantDb(bc.organizationId);
  const c = await tdb.candidate.findFirst({ where: { id: bc.candidateId }, select: { id: true, name: true } });
  let status: string | null = null;
  const data: Record<string, unknown> = {};
  if (ev.type === 'invitation.completed') { status = 'pending'; if (o.report_id) data.externalReportId = o.report_id; }
  else if (ev.type === 'invitation.expired') status = 'expired';
  else if (ev.type === 'invitation.deleted') status = 'canceled';
  else if (ev.type === 'report.completed') { status = o.result === 'clear' ? 'clear' : 'consider'; data.completedAt = new Date(); data.externalReportId = o.id; }
  else if (REPORT_STATUS[ev.type]) { status = REPORT_STATUS[ev.type]; data.externalReportId = o.id; }
  if (!status) return null;
  await tdb.backgroundCheck.updateMany({ where: { id: bc.id }, data: { ...data, status } });
  if (c && status === 'clear') {
    // A clear report counts as a verified background-check credential for a year.
    const expires = new Date(); expires.setUTCFullYear(expires.getUTCFullYear() + 1);
    await tdb.credential.create({ data: { candidateId: c.id, type: 'Background check', issuedAt: new Date(), expiresAt: expires, verifiedAt: new Date(), verifyMethod: 'Checkr report', verifyNote: `Checkr report ${o.id} (${bc.package}): clear` } as never });
  }
  if (c) await logActivity(bc.organizationId, status === 'consider'
    ? `${c.name}’s background check needs review (“consider”). Review the report in Checkr and follow the FCRA adverse-action steps before deciding.`
    : `${c.name}’s background check is ${status === 'pending' ? 'in progress' : status}`);
  return { id: bc.id, status };
}

export const STATUS_LABEL: Record<string, string> = { invited: 'Waiting for candidate', pending: 'In progress', clear: 'Clear', consider: 'Needs review', suspended: 'Suspended', canceled: 'Canceled', dispute: 'Disputed', expired: 'Invitation expired' };
