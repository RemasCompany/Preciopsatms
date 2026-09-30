import { z } from 'zod';
import type { Organization, User } from '@prisma/client';
import { db } from './db';
import { HttpError, tenantDb, logActivity, type TenantDb } from './tenant';
import { hasFeature } from './plans';
import { newToken, sha256 } from './tokens';
import { sendEmail } from './email';
import { assignmentWhere, deliver, type Channel } from './schedule-server';
import { localDate } from './timeclock';
import { addFromClientFeedback } from './dnr';
import { PULSE_DAYS, RECOGNITION_KINDS, birthdayMessage, nextBirthday, recognitionMessage, validBirthday } from './engagement';

const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';
const first = (name: string) => name.split(' ')[0] || 'there';

export function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Invalid input');
  return r.data;
}

export const Birthday = z.object({
  month: z.union([z.number().int(), z.null()]), day: z.union([z.number().int(), z.null()]),
}).refine((b) => (b.month === null) === (b.day === null) && (b.month === null || validBirthday(b.month, b.day!)), 'Choose a valid month and day.');

export const RecognitionBody = z.object({
  candidateId: z.string().min(1),
  applicationId: z.string().optional().nullable(),
  kind: z.enum(Object.keys(RECOGNITION_KINDS) as [keyof typeof RECOGNITION_KINDS], { errorMap: () => ({ message: 'Choose a type of recognition.' }) }),
  message: z.string().trim().min(5, 'Say what they did — it means more.').max(500, 'Keep it under 500 characters.'),
  visibleToWorker: z.boolean().default(true),
  channels: z.array(z.enum(['email', 'sms'])).max(2).default([]),
});

export const Rating = z.number({ required_error: 'Choose a rating.', invalid_type_error: 'Choose a rating.' }).int().min(1, 'Choose a rating.').max(5, 'Choose a rating.');

/** Staff give recognition; optionally tell the worker by text or email (opt-outs honored, every attempt logged). */
export async function giveRecognition(org: Organization, user: User, b: z.infer<typeof RecognitionBody>) {
  const tdb = tenantDb(org.id);
  const c = await tdb.candidate.findFirst({ where: { id: b.candidateId } });
  if (!c) throw new HttpError(404, 'That person was deleted.');
  if (b.applicationId && !(await tdb.application.findFirst({ where: { id: b.applicationId, candidateId: c.id } }))) throw new HttpError(404, 'That assignment wasn’t found.');
  const r = await tdb.recognition.create({ data: { candidateId: c.id, applicationId: b.applicationId ?? null, kind: b.kind, message: b.message, visibleToWorker: b.visibleToWorker, createdById: user.id } as never });
  const company = org.shortName ?? org.name, sent: Channel[] = [], problems: string[] = [];
  for (const ch of [...new Set(b.channels)]) {
    const problem = await deliver(tdb, c, ch, recognitionMessage({ firstName: first(c.name), company, kind: b.kind, message: b.message, channel: ch }), { name: company, replyTo: user.email }, user.id);
    if (problem) problems.push(`${ch === 'sms' ? 'Text' : 'Email'}: ${problem}`); else sent.push(ch);
  }
  if (sent.length) await tdb.recognition.updateMany({ where: { id: r.id }, data: { notifiedAt: new Date() } });
  await logActivity(org.id, `${RECOGNITION_KINDS[b.kind].label} for ${c.name}: ${b.message}`, user.id);
  return { id: r.id, sent, problems };
}

/** Emails a client contact a one-time link to rate a worker on their assignment. */
export async function requestClientFeedback(org: Organization, user: User, applicationId: string, contactId: string) {
  const tdb = tenantDb(org.id);
  const app = await tdb.application.findFirst({ where: { id: applicationId }, include: { candidate: true, job: { include: { client: true } } } });
  if (!app || !app.job.clientId) throw new HttpError(404, 'That assignment has no client to ask.');
  const contact = await tdb.contact.findFirst({ where: { id: contactId, clientId: app.job.clientId } });
  if (!contact) throw new HttpError(404, `Choose a contact at ${app.job.client!.name}.`);
  if (!contact.email) throw new HttpError(400, `${contact.name} has no email address.`);
  const token = newToken();
  await tdb.feedbackRequest.create({ data: { applicationId: app.id, contactId: contact.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 21 * 864e5), createdById: user.id } as never });
  const company = org.shortName ?? org.name, link = `${appUrl()}/feedback/${token}`;
  try {
    await sendEmail({ to: contact.email, replyTo: user.email, fromName: company, subject: `How is ${app.candidate.name} doing?`,
      text: `Hi ${first(contact.name)},\n\nHow is ${app.candidate.name} doing as ${app.job.title}? It takes 30 seconds to rate their work, and it helps us make sure you have the right people.\n\n${link}\n\nThank you,\n${user.name ?? ''}\n${company}` });
    await tdb.message.create({ data: { channel: 'email', toAddress: contact.email, subject: `How is ${app.candidate.name} doing?`, body: link.replace(token, '…'), relatedType: 'contact', relatedId: contact.id, status: 'sent', sentById: user.id } as never });
  } catch (e) {
    await tdb.message.create({ data: { channel: 'email', toAddress: contact.email, subject: `How is ${app.candidate.name} doing?`, body: '(feedback request)', relatedType: 'contact', relatedId: contact.id, status: 'failed', error: String((e as Error).message).slice(0, 300), sentById: user.id } as never });
    throw new HttpError(502, 'The email couldn’t be sent. Check the contact’s email address and try again.');
  }
  await logActivity(org.id, `Asked ${contact.name} (${app.job.client!.name}) for feedback on ${app.candidate.name}`, user.id);
  return { ok: true };
}

/** A client feedback link: who it's about, if it's still open. */
export async function resolveFeedbackLink(token: string) {
  if (!token || token.length > 100) return null;
  const r = await db.feedbackRequest.findUnique({ where: { tokenHash: sha256(token) }, include: { organization: true } });
  if (!r || r.completedAt || r.expiresAt < new Date()) return null;
  const tdb = tenantDb(r.organizationId);
  const app = await tdb.application.findFirst({ where: { id: r.applicationId }, include: { candidate: { select: { id: true, name: true } }, job: { select: { title: true, client: { select: { id: true, name: true } } } } } });
  const contact = await tdb.contact.findFirst({ where: { id: r.contactId }, select: { name: true } });
  if (!app || !contact) return null;
  return { r, tdb, app, contact };
}

export const ClientFeedback = z.object({
  rating: Rating, wouldRehire: z.boolean({ required_error: 'Tell us whether you’d have them back.', invalid_type_error: 'Tell us whether you’d have them back.' }),
  comment: z.string().trim().max(1000, 'Keep comments under 1,000 characters.').optional(),
});

export async function submitClientFeedback(token: string, body: unknown) {
  const found = await resolveFeedbackLink(token);
  if (!found) throw new HttpError(404, 'This feedback link has expired or was already used.');
  const b = parse(ClientFeedback, body);
  const { r, tdb, app, contact } = found;
  const f = await tdb.feedback.create({ data: { candidateId: app.candidate.id, applicationId: app.id, source: 'CLIENT', rating: b.rating, wouldRehire: b.wouldRehire, comment: b.comment || null, authorName: contact.name, contactId: r.contactId } as never });
  await tdb.feedbackRequest.updateMany({ where: { id: r.id, completedAt: null }, data: { completedAt: new Date(), feedbackId: f.id } });
  await logActivity(r.organizationId, `${contact.name} (${app.job.client?.name ?? 'client'}) rated ${app.candidate.name} ${b.rating}/5${b.wouldRehire ? '' : ' — would NOT have them back'}`);
  if (!b.wouldRehire && app.job.client) await addFromClientFeedback(tdb, r.organizationId, app.candidate, app.job.client, contact.name, b.comment);
  return { ok: true };
}

// ---- the worker's side ----
type Link = { organizationId: string; candidateId: string; organization: Organization; candidate: { name: string } };

export async function workerEngagement(orgId: string, candidateId: string) {
  const tdb = tenantDb(orgId);
  const [c, onAssignment, lastPulse, recognitions] = await Promise.all([
    tdb.candidate.findFirst({ where: { id: candidateId }, select: { birthMonth: true, birthDay: true } }),
    tdb.application.count({ where: { candidateId, ...assignmentWhere } }),
    tdb.feedback.findFirst({ where: { candidateId, source: 'WORKER' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    tdb.recognition.findMany({ where: { candidateId, visibleToWorker: true }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, kind: true, message: true, createdAt: true } }),
  ]);
  return {
    onAssignment: onAssignment > 0,
    askPulse: onAssignment > 0 && (!lastPulse || Date.now() - lastPulse.createdAt.getTime() > PULSE_DAYS * 864e5),
    birthdaySet: !!(c?.birthMonth && c.birthDay),
    recognitions: recognitions.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  };
}

export const WorkerAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pulse'), rating: Rating, comment: z.string().trim().max(1000, 'Keep comments under 1,000 characters.').optional() }),
  z.object({ action: z.literal('birthday'), month: z.number().int(), day: z.number().int() }),
]);

export async function workerAct(link: Link, body: unknown) {
  const b = parse(WorkerAction, body);
  const tdb = tenantDb(link.organizationId);
  if (b.action === 'birthday') {
    if (!validBirthday(b.month, b.day)) throw new HttpError(400, 'Choose a valid month and day.');
    await tdb.candidate.updateMany({ where: { id: link.candidateId }, data: { birthMonth: b.month, birthDay: b.day } });
    return { message: 'Thanks! We’ll remember your birthday.' };
  }
  const app = await tdb.application.findFirst({ where: { candidateId: link.candidateId, ...assignmentWhere }, orderBy: { stageChangedAt: 'desc' }, include: { job: { select: { title: true } } } });
  if (!app) throw new HttpError(409, 'You’re not on an assignment right now.');
  await tdb.feedback.create({ data: { candidateId: link.candidateId, applicationId: app.id, source: 'WORKER', rating: b.rating, comment: b.comment || null } as never });
  if (b.rating <= 2) await logActivity(link.organizationId, `${link.candidate.name} rated their ${app.job.title} assignment ${b.rating}/5 — follow up${b.comment ? `: “${b.comment.slice(0, 200)}”` : ''}`);
  return { message: b.rating <= 2 ? 'Thanks for telling us. Your recruiter will reach out soon.' : 'Thanks for letting us know!' };
}

/** Daily: birthday greetings for workers on assignment, in each company that turned them on. Once a year each. */
export async function runBirthdayGreetings(now = new Date()) {
  const orgs = await db.organization.findMany({ where: { birthdayGreetings: true, subscriptionStatus: { in: ['trialing', 'active'] } } });
  let sent = 0;
  for (const org of orgs) {
    if (!hasFeature(org, 'engagement')) continue;
    const today = localDate(now, org.timezone), year = Number(today.slice(0, 4));
    const tdb: TenantDb = tenantDb(org.id);
    const people = await tdb.candidate.findMany({ where: { birthMonth: { not: null }, birthDay: { not: null }, applications: { some: assignmentWhere }, OR: [{ lastGreetedYear: null }, { lastGreetedYear: { lt: year } }] } });
    for (const c of people) {
      if (nextBirthday(c.birthMonth!, c.birthDay!, today) !== today) continue;
      const ch: Channel = c.phone && !c.smsOptOut ? 'sms' : 'email';
      const problem = await deliver(tdb, c, ch, birthdayMessage({ firstName: first(c.name), company: org.shortName ?? org.name, channel: ch }), { name: org.shortName ?? org.name }, null);
      await tdb.candidate.updateMany({ where: { id: c.id }, data: { lastGreetedYear: year } });
      if (!problem) { sent++; await logActivity(org.id, `Sent ${c.name} a birthday greeting`); }
    }
  }
  return { sent };
}
