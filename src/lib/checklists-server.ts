import { z } from 'zod';
import type { Organization, User } from '@prisma/client';
import { HttpError, logActivity, tenantDb, type TenantDb } from './tenant';
import { newToken, sha256 } from './tokens';
import { deliver, type Channel } from './schedule-server';
import { audit } from './audit';
import { CHECKLIST_KEYS, SKILLS_CHECKLISTS, VALID_MONTHS, checkAnswers, summarize } from './skills-checklists';

const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export const SendBody = z.object({
  candidateId: z.string().min(1),
  specialty: z.string().refine((k) => CHECKLIST_KEYS.includes(k), 'Choose a checklist.'),
  channels: z.array(z.enum(['sms', 'email'])).min(1, 'Choose how to send it.').max(2),
});

/**
 * Sends a skills checklist to the worker's private link. One open checklist per specialty: sending again re-sends it.
 * Each channel is one message, logged, and opt-outs are honored.
 */
export async function sendChecklist(org: Organization, user: User, b: z.infer<typeof SendBody>) {
  const tdb = tenantDb(org.id);
  const c = await tdb.candidate.findFirst({ where: { id: b.candidateId }, select: { id: true, name: true, email: true, phone: true, emailOptOut: true, smsOptOut: true } });
  if (!c) throw new HttpError(404, 'That candidate was deleted.');
  const spec = SKILLS_CHECKLISTS[b.specialty];
  const open = await tdb.skillsChecklist.findFirst({ where: { candidateId: c.id, specialty: b.specialty, status: 'SENT' } });
  const cl = open ?? await tdb.skillsChecklist.create({ data: { candidateId: c.id, specialty: b.specialty, sentById: user.id } as never });
  const token = newToken();
  await tdb.workerLink.create({ data: { candidateId: c.id, tokenHash: sha256(token), kind: 'checklist', expiresAt: new Date(Date.now() + 30 * 864e5) } as never });
  const link = `${appUrl()}/shifts/${token}`, company = org.shortName ?? org.name, first = c.name.split(' ')[0] || 'there';
  const msg = (ch: Channel) => ch === 'sms'
    ? { subject: '', text: `${company}: please fill out your ${spec.title} skills checklist (about 10 minutes, on your phone): ${link}` }
    : { subject: `${company}: your ${spec.title} skills checklist`, text: `Hi ${first},\n\nPlease rate your experience with each skill on the ${spec.title} skills checklist. It takes about 10 minutes and works on your phone:\n\n${link}\n\nBe honest — it helps us place you where you’ll do well and plan any orientation you need. It goes to the facilities you’re submitted to.\n\nThis link is just for you, so please don’t share it.\n\nThank you,\n${company}` };
  const problems: string[] = [];
  for (const ch of b.channels) {
    const p = await deliver(tdb, c, ch, msg(ch), { name: company, replyTo: user.email }, user.id);
    if (p) problems.push(`${ch === 'sms' ? 'Text' : 'Email'}: ${p}`);
  }
  if (problems.length === b.channels.length) throw new HttpError(409, `The checklist wasn’t sent — ${problems.join('; ')}.`);
  await logActivity(org.id, `Sent ${c.name} the ${spec.title} skills checklist`, user.id);
  await audit(org.id, user, 'checklist.send', `Sent ${c.name} the ${spec.title} skills checklist`, { targetType: 'candidate', targetId: c.id });
  return { id: cl.id, problems };
}

export async function cancelChecklist(org: Organization, user: User, id: string) {
  const tdb = tenantDb(org.id);
  const cl = await tdb.skillsChecklist.findFirst({ where: { id, status: 'SENT' }, include: { candidate: { select: { name: true } } } });
  if (!cl) throw new HttpError(404, 'That checklist was already completed or cancelled.');
  await tdb.skillsChecklist.updateMany({ where: { id, status: 'SENT' }, data: { status: 'CANCELLED' } });
  await logActivity(org.id, `Cancelled ${cl.candidate.name}’s ${SKILLS_CHECKLISTS[cl.specialty]?.title ?? cl.specialty} skills checklist`, user.id);
}

/** A candidate's checklists for their record: open ones, and completed ones with the summary. */
export async function candidateChecklists(tdb: TenantDb, candidateId: string) {
  const rows = await tdb.skillsChecklist.findMany({ where: { candidateId, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' } });
  const today = ymd(new Date());
  return rows.map((r) => {
    const s = r.answers ? summarize(r.specialty, r.answers as Record<string, number>) : null;
    return {
      id: r.id, specialty: r.specialty, title: SKILLS_CHECKLISTS[r.specialty]?.title ?? r.specialty, status: r.status as 'SENT' | 'COMPLETED',
      sentAt: r.createdAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null, expiresAt: r.expiresAt ? ymd(r.expiresAt) : null,
      expired: !!r.expiresAt && ymd(r.expiresAt) < today, signedName: r.signedName, average: s?.average ?? null, needsSupport: s?.needsSupport ?? [],
    };
  });
}

/** Open checklists for the worker's page, with the items to rate. */
export async function workerChecklists(orgId: string, candidateId: string) {
  const rows = await tenantDb(orgId).skillsChecklist.findMany({ where: { candidateId, status: 'SENT' }, orderBy: { createdAt: 'asc' } });
  return rows.filter((r) => SKILLS_CHECKLISTS[r.specialty]).map((r) => ({ id: r.id, title: SKILLS_CHECKLISTS[r.specialty].title, sections: SKILLS_CHECKLISTS[r.specialty].sections }));
}

export const SubmitBody = z.object({
  checklistId: z.string().min(1),
  answers: z.record(z.number()),
  signedName: z.string().trim().min(2, 'Type your full name to sign.').max(120, 'That name is too long.'),
  attest: z.literal(true, { errorMap: () => ({ message: 'Confirm that your answers are accurate.' }) }),
});

/** The worker submits their ratings and signs. Good for a year. */
export async function submitChecklist(link: { organizationId: string; candidateId: string; candidate: { name: string } }, b: z.infer<typeof SubmitBody>) {
  const tdb = tenantDb(link.organizationId);
  const cl = await tdb.skillsChecklist.findFirst({ where: { id: b.checklistId, candidateId: link.candidateId } });
  if (!cl) throw new HttpError(404, 'That checklist isn’t for you.');
  if (cl.status !== 'SENT') throw new HttpError(409, cl.status === 'COMPLETED' ? 'You already sent this checklist. Thank you!' : 'This checklist was cancelled.');
  const a = checkAnswers(cl.specialty, b.answers);
  if (!a.ok) throw new HttpError(400, a.error);
  const now = new Date(), until = new Date(now); until.setUTCMonth(until.getUTCMonth() + VALID_MONTHS);
  await tdb.skillsChecklist.updateMany({ where: { id: cl.id, status: 'SENT' }, data: { status: 'COMPLETED', answers: a.answers, signedName: b.signedName, completedAt: now, expiresAt: new Date(`${ymd(until)}T00:00:00Z`) } });
  await logActivity(link.organizationId, `${link.candidate.name} completed the ${SKILLS_CHECKLISTS[cl.specialty].title} skills checklist`);
  return { message: 'Thank you — your checklist is in.' };
}
