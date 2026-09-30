import { z } from 'zod';
import type { Organization, User } from '@prisma/client';
import { db } from './db';
import { HttpError, logActivity, tenantDb, type TenantDb } from './tenant';
import { hasFeature } from './plans';
import { newToken, sha256 } from './tokens';
import { sendEmail } from './email';
import { lineCents, toCents } from './invoicing';
import { balanceCents } from './invoicing-server';
import { localDate } from './timeclock';
import { ymd } from './weeks';
import { addFromClientFeedback } from './dnr';

const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';
const LINK_DAYS = 90;
const first = (n: string) => n.split(' ')[0] || 'there';

/**
 * The client portal: a client contact's own view of their job orders, workers, hours, schedule and invoices.
 * Contacts sign in with a private link (no password). Everything is scoped to the contact's client and company.
 * Pay rates, margins and anything about other clients never leave the server.
 */

/** Emails a contact a fresh portal link. Earlier links keep working (another device) until they expire or are revoked. */
export async function sendPortalLink(org: Organization, contactId: string, sentBy: User | null) {
  const tdb = tenantDb(org.id);
  const c = await tdb.contact.findFirst({ where: { id: contactId }, include: { client: true } });
  if (!c) throw new HttpError(404, 'That contact was deleted.');
  if (!c.email) throw new HttpError(400, `${c.name} has no email address.`);
  const token = newToken();
  await tdb.clientPortalLink.create({ data: { contactId: c.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + LINK_DAYS * 864e5), createdById: sentBy?.id ?? null } as never });
  const company = org.shortName ?? org.name, link = `${appUrl()}/client/${token}`;
  const subject = `Your ${company} client portal`;
  const text = `Hi ${first(c.name)},\n\nHere’s your private link to the ${company} client portal for ${c.client.name}. You can approve your workers’ hours, see who’s scheduled, request new staff, rate workers and download invoices.\n\n${link}\n\nThe link works for ${LINK_DAYS} days and is just for you — please don’t forward it. You can always get a new one at ${appUrl()}/client/login?c=${org.slug}\n\n${company}`;
  try {
    await sendEmail({ to: c.email, subject, text, fromName: company, replyTo: sentBy?.email });
    await tdb.message.create({ data: { channel: 'email', toAddress: c.email, subject, body: text.replace(token, '…'), relatedType: 'contact', relatedId: c.id, status: 'sent', sentById: sentBy?.id ?? null } as never });
  } catch (e) {
    await tdb.clientPortalLink.deleteMany({ where: { tokenHash: sha256(token) } });
    throw new HttpError(502, `The email to ${c.email} couldn’t be sent. Check the address and try again.`);
  }
  if (sentBy) await logActivity(org.id, `Sent ${c.name} (${c.client.name}) a client portal link`, sentBy.id);
}

export async function revokePortal(org: Organization, contactId: string, user: User) {
  const tdb = tenantDb(org.id);
  const c = await tdb.contact.findFirst({ where: { id: contactId } });
  if (!c) throw new HttpError(404, 'That contact was deleted.');
  const { count } = await tdb.clientPortalLink.updateMany({ where: { contactId: c.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await logActivity(org.id, `Turned off client portal access for ${c.name}`, user.id);
  return count;
}

export type Portal = { org: Organization; tdb: TenantDb; contact: { id: string; name: string; email: string | null }; client: { id: string; name: string; paymentTerms: string } };

/** The portal session behind a link, or null if it's invalid, expired, revoked, or the company's plan no longer has the portal. */
export async function resolvePortal(token: string): Promise<Portal | null> {
  if (!token || token.length > 100) return null;
  const l = await db.clientPortalLink.findUnique({ where: { tokenHash: sha256(token) }, include: { organization: true } });
  if (!l || l.revokedAt || l.expiresAt < new Date() || !hasFeature(l.organization, 'clientPortal')) return null;
  const tdb = tenantDb(l.organizationId);
  const contact = await tdb.contact.findFirst({ where: { id: l.contactId }, include: { client: { select: { id: true, name: true, paymentTerms: true } } } });
  if (!contact) return null;
  if (!l.lastUsedAt || Date.now() - l.lastUsedAt.getTime() > 3600e3) await tdb.clientPortalLink.updateMany({ where: { id: l.id }, data: { lastUsedAt: new Date() } });
  return { org: l.organization, tdb, contact: { id: contact.id, name: contact.name, email: contact.email }, client: contact.client };
}

const WEEKS = 6;
/** Everything the portal shows. Bill rates and amounts only — never pay rates. */
export async function portalData(p: Portal) {
  const { tdb, client, org } = p;
  const today = localDate(new Date(), org.timezone), todayD = new Date(`${today}T00:00:00Z`);
  const since = new Date(todayD.getTime() - WEEKS * 7 * 864e5), until = new Date(todayD.getTime() + 14 * 864e5);
  const ofClient = { job: { clientId: client.id } };
  const [jobs, placed, timesheets, shifts, invoices] = await Promise.all([
    tdb.job.findMany({ where: { clientId: client.id, OR: [{ status: { in: ['OPEN', 'ON_HOLD'] } }, { updatedAt: { gte: since } }] }, orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, title: true, status: true, openings: true, type: true, location: true, startDate: true, billRate: true, createdAt: true, _count: { select: { applications: { where: { stage: 'PLACED' } } } } } }),
    tdb.application.findMany({ where: { ...ofClient, stage: 'PLACED' }, orderBy: { stageChangedAt: 'desc' }, select: { id: true, stageChangedAt: true, candidate: { select: { name: true } }, job: { select: { title: true } } } }),
    tdb.timesheet.findMany({ where: { application: ofClient, weekEnding: { gte: since } }, orderBy: [{ weekEnding: 'desc' }], select: { id: true, weekEnding: true, regularHours: true, overtimeHours: true, billRate: true, status: true, clientApprovedAt: true, clientApprovedBy: true, clientDisputeNote: true, application: { select: { candidate: { select: { name: true } }, job: { select: { title: true } } } } } }),
    tdb.shift.findMany({ where: { application: ofClient, cancelled: false, date: { gte: todayD, lte: until } }, orderBy: [{ date: 'asc' }, { start: 'asc' }], select: { id: true, date: true, start: true, end: true, unit: true, response: true, application: { select: { candidate: { select: { name: true } }, job: { select: { title: true } } } } } }),
    tdb.invoice.findMany({ where: { clientId: client.id, status: { not: 'VOID' } }, orderBy: { issueDate: 'desc' }, take: 24 }),
  ]);
  return {
    company: org.shortName ?? org.name, brandColor: org.brandColor, logoUrl: org.logoUrl, contactEmail: org.applyEmail,
    contact: { name: p.contact.name }, client: { name: client.name, terms: client.paymentTerms },
    jobs: jobs.map((j) => ({ id: j.id, title: j.title, status: j.status, openings: j.openings, filled: j._count.applications, type: j.type, location: j.location, startDate: j.startDate ? ymd(j.startDate) : null, billRate: j.billRate ? Number(j.billRate) : null })),
    workers: placed.map((a) => ({ applicationId: a.id, name: a.candidate.name, job: a.job.title, since: ymd(a.stageChangedAt) })),
    timesheets: timesheets.filter((t) => Number(t.regularHours) + Number(t.overtimeHours) > 0).map((t) => {
      const reg = Number(t.regularHours), ot = Number(t.overtimeHours), bill = Number(t.billRate);
      return { id: t.id, week: ymd(t.weekEnding), worker: t.application.candidate.name, job: t.application.job.title, reg, ot, billRate: bill, amount: lineCents(reg, ot, bill) / 100,
        approvedAt: t.clientApprovedAt?.toISOString() ?? null, approvedBy: t.clientApprovedBy, dispute: t.clientDisputeNote, locked: t.status === 'PAID' && !!t.clientApprovedAt };
    }),
    shifts: shifts.map((s) => ({ id: s.id, date: ymd(s.date), start: s.start, end: s.end, unit: s.unit, confirmed: s.response === 'CONFIRMED', worker: s.application.candidate.name, job: s.application.job.title })),
    invoices: invoices.map((i) => ({ id: i.id, number: i.number, issued: ymd(i.issueDate), due: ymd(i.dueDate), total: toCents(i.total) / 100, balance: balanceCents(i) / 100, status: i.status, overdue: ['DRAFT', 'SENT', 'PARTIAL'].includes(i.status) && ymd(i.dueDate) < today })),
  };
}

export const PortalAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), timesheetIds: z.array(z.string()).min(1, 'Choose the hours to approve.').max(200) }),
  z.object({ action: z.literal('dispute'), timesheetId: z.string(), note: z.string().trim().min(5, 'Tell us what looks wrong.').max(500, 'Keep it under 500 characters.') }),
  z.object({ action: z.literal('rate'), applicationId: z.string(), rating: z.number({ required_error: 'Choose a rating.', invalid_type_error: 'Choose a rating.' }).int().min(1, 'Choose a rating.').max(5, 'Choose a rating.'),
    wouldRehire: z.boolean({ required_error: 'Tell us whether you’d have them back.', invalid_type_error: 'Tell us whether you’d have them back.' }), comment: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal('requestJob'), title: z.string().trim().min(2, 'What’s the position?').max(120), openings: z.number().int().min(1, 'How many people?').max(500),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a start date.'), shift: z.string().trim().max(120).optional(), location: z.string().trim().max(120).optional(), notes: z.string().trim().max(2000).optional() }),
]);

export async function portalAct(p: Portal, body: unknown) {
  const r = PortalAction.safeParse(body ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Invalid input');
  const b = r.data, { tdb, client, contact, org } = p;
  const who = `${contact.name} (${client.name})`;
  if (b.action === 'approve') {
    const ts = await tdb.timesheet.findMany({ where: { id: { in: b.timesheetIds }, application: { job: { clientId: client.id } } }, select: { id: true } });
    if (ts.length !== new Set(b.timesheetIds).size) throw new HttpError(404, 'Some of those hours were changed or removed. Reload and try again.');
    await tdb.timesheet.updateMany({ where: { id: { in: ts.map((t) => t.id) } }, data: { clientApprovedAt: new Date(), clientApprovedBy: contact.name, clientDisputeNote: null, clientDisputedAt: null } });
    await logActivity(org.id, `${who} approved ${ts.length} timesheet${ts.length === 1 ? '' : 's'} in the client portal`);
    return { message: `Thanks — ${ts.length} timesheet${ts.length === 1 ? '' : 's'} approved.` };
  }
  if (b.action === 'dispute') {
    const t = await tdb.timesheet.findFirst({ where: { id: b.timesheetId, application: { job: { clientId: client.id } } }, include: { application: { include: { candidate: { select: { name: true } } } } } });
    if (!t) throw new HttpError(404, 'Those hours were changed or removed. Reload and try again.');
    await tdb.timesheet.updateMany({ where: { id: t.id }, data: { clientDisputeNote: b.note, clientDisputedAt: new Date(), clientApprovedAt: null, clientApprovedBy: null } });
    await logActivity(org.id, `${who} questioned ${t.application.candidate.name}’s hours for the week ending ${ymd(t.weekEnding)}: “${b.note}”`);
    await tdb.task.create({ data: { title: `Client question on ${t.application.candidate.name}’s hours (week ending ${ymd(t.weekEnding)}): ${b.note}`.slice(0, 300), dueAt: new Date(Date.now() + 864e5), priority: 'High', related: client.name } as never });
    return { message: 'Thanks — we’ll look into it and get back to you.' };
  }
  if (b.action === 'rate') {
    const app = await tdb.application.findFirst({ where: { id: b.applicationId, job: { clientId: client.id } }, include: { candidate: { select: { id: true, name: true } } } });
    if (!app) throw new HttpError(404, 'That worker isn’t on one of your assignments.');
    await tdb.feedback.create({ data: { candidateId: app.candidate.id, applicationId: app.id, source: 'CLIENT', rating: b.rating, wouldRehire: b.wouldRehire, comment: b.comment || null, authorName: contact.name, contactId: contact.id } as never });
    await logActivity(org.id, `${who} rated ${app.candidate.name} ${b.rating}/5 in the client portal${b.wouldRehire ? '' : ' — would NOT have them back'}`);
    if (!b.wouldRehire) await addFromClientFeedback(tdb, org.id, app.candidate, client, contact.name, b.comment);
    return { message: `Thanks for rating ${first(app.candidate.name)}.` };
  }
  if (b.startDate < localDate(new Date(), org.timezone)) throw new HttpError(400, 'The start date is in the past.');
  const job = await tdb.job.create({ data: { clientId: client.id, title: b.title, openings: b.openings, startDate: new Date(`${b.startDate}T00:00:00Z`), location: b.location || null, status: 'ON_HOLD', publish: false,
    description: [`Requested by ${contact.name} in the client portal.`, b.shift ? `Shift: ${b.shift}` : '', b.notes ?? ''].filter(Boolean).join('\n\n') } as never });
  await tdb.task.create({ data: { title: `New job order from ${who}: ${b.openings} × ${b.title}, starting ${b.startDate}. Review and open it.`.slice(0, 300), dueAt: new Date(Date.now() + 864e5), priority: 'High', related: client.name } as never });
  await logActivity(org.id, `${who} requested ${b.openings} × ${b.title} starting ${b.startDate} in the client portal`);
  return { message: 'Thanks — your request is in. Your recruiter will confirm the details shortly.', jobId: job.id };
}
