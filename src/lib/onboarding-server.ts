import { z } from 'zod';
import type { Organization, User } from '@prisma/client';
import { HttpError, tenantDb, logActivity, type TenantDb } from './tenant';
import { newToken, sha256 } from './tokens';
import { merge, orgContext, hasBlanks } from './merge';
import { TEMPLATES } from './doc-templates';
import { jobMergeFields } from './merge-fields';
import { putFile } from './storage';
import { deliver, type Channel } from './schedule-server';
import { PackageBody, progress, type StepDef, type StepState } from './onboarding';

const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function parsePackage(body: unknown) {
  const r = PackageBody.safeParse(body ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Invalid input');
  return r.data;
}

/** Credential types the candidate has verified and not expired (CREDENTIAL steps follow these). */
export async function verifiedTypes(tdb: TenantDb, candidateId: string) {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const creds = await tdb.credential.findMany({ where: { candidateId, verifiedAt: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gte: today } }] }, select: { type: true } });
  return new Set(creds.map((c) => c.type));
}

const stepState = (s: { id: string; kind: string; label: string; required: boolean; status: 'PENDING' | 'DONE' | 'WAIVED'; config: unknown }): StepState => ({ ...s, config: (s.config ?? {}) as Record<string, unknown> });

/** Marks an onboarding complete when every required step is done (or back in progress if a credential lapsed). */
export async function recompute(tdb: TenantDb, onboardingId: string) {
  const ob = await tdb.onboarding.findFirst({ where: { id: onboardingId }, include: { steps: true, application: { select: { candidate: { select: { name: true } } } } } });
  if (!ob || ob.status === 'CANCELLED') return null;
  const p = progress(ob.steps.map(stepState), await verifiedTypes(tdb, ob.candidateId));
  if (p.ready && ob.status === 'IN_PROGRESS') {
    await tdb.onboarding.updateMany({ where: { id: ob.id }, data: { status: 'COMPLETE', completedAt: new Date() } });
    await logActivity(ob.organizationId, `${ob.application.candidate.name} finished onboarding (${ob.packageName}) and is ready to start`);
  } else if (!p.ready && ob.status === 'COMPLETE') {
    await tdb.onboarding.updateMany({ where: { id: ob.id }, data: { status: 'IN_PROGRESS', completedAt: null } });
  }
  return p;
}

/** Copies a package's steps onto a new hire's assignment and drafts its documents with their details merged in. */
export async function startOnboarding(org: Organization, user: User, b: { applicationId: string; packageId: string; startDate?: string | null }) {
  const tdb = tenantDb(org.id);
  const app = await tdb.application.findFirst({ where: { id: b.applicationId }, include: { candidate: true, job: { include: { client: true } } } });
  if (!app) throw new HttpError(404, 'That application was deleted.');
  if (app.stage !== 'OFFER' && app.stage !== 'PLACED') throw new HttpError(409, `Move ${app.candidate.name} to Offer or Placed before starting onboarding.`);
  if (await tdb.onboarding.findFirst({ where: { applicationId: app.id, status: { not: 'CANCELLED' } } })) throw new HttpError(409, `${app.candidate.name} is already onboarding for this job.`);
  const pkg = await tdb.onboardingPackage.findFirst({ where: { id: b.packageId, archived: false } });
  if (!pkg) throw new HttpError(404, 'Choose an onboarding package.');
  const steps = parsePackage({ name: pkg.name, steps: pkg.steps }).steps;
  const start = b.startDate ? new Date(`${b.startDate}T00:00:00Z`) : app.job.startDate;
  const ctx = { ...orgContext(org), ...jobMergeFields(app.job, start), name: app.candidate.name, date: new Date().toLocaleDateString('en-US', { dateStyle: 'long' }) };
  const onboarding = await tdb.$transaction(async (tx) => {
    const ob = await tx.onboarding.create({ data: { applicationId: app.id, candidateId: app.candidateId, packageId: pkg.id, packageName: pkg.name, startDate: start, createdById: user.id } as never });
    let pos = 0;
    for (const s of steps) {
      let signDocumentId: string | null = null;
      if (s.kind === 'SIGN') {
        const tpl = s.doc === 'custom' ? null : TEMPLATES[s.doc];
        const title = `${s.doc === 'custom' ? s.title! : tpl!.name} — ${app.candidate.name}`;
        const doc = await tx.signDocument.create({ data: {
          type: s.doc, relatedType: 'candidate', relatedId: app.candidateId, title, body: merge(s.doc === 'custom' ? s.body! : tpl!.body, ctx),
          signerName: app.candidate.name, signerEmail: app.candidate.email ?? '', audit: [{ at: new Date().toISOString(), event: 'created', by: user.email, via: `onboarding: ${pkg.name}` }],
        } as never });
        signDocumentId = doc.id;
      }
      const { kind, label, hint, required, ...config } = s as StepDef & Record<string, unknown>;
      await tx.onboardingStep.create({ data: { onboardingId: ob.id, position: pos++, kind, label, hint: hint ?? null, required, config: config as object, signDocumentId } as never });
    }
    return ob;
  });
  await logActivity(org.id, `Started onboarding for ${app.candidate.name} (${pkg.name}, ${app.job.title})`, user.id);
  return onboarding;
}

/** Sends the new hire their private onboarding link. */
export async function inviteOnboarding(org: Organization, user: User, onboardingId: string, channels: Channel[]) {
  const tdb = tenantDb(org.id);
  const ob = await tdb.onboarding.findFirst({ where: { id: onboardingId }, include: { application: { include: { candidate: true, job: true } } } });
  if (!ob) throw new HttpError(404, 'That onboarding was deleted.');
  if (ob.status === 'CANCELLED') throw new HttpError(409, 'This onboarding was cancelled.');
  const c = ob.application.candidate;
  const token = newToken();
  await tdb.workerLink.create({ data: { candidateId: c.id, tokenHash: sha256(token), kind: 'onboarding', expiresAt: new Date(Date.now() + 45 * 864e5) } as never });
  const link = `${appUrl()}/shifts/${token}`, company = org.shortName ?? org.name, first = c.name.split(' ')[0] || 'there';
  const start = ob.startDate ? ` before you start on ${ob.startDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}` : '';
  const msg = (ch: Channel) => ch === 'sms'
    ? { subject: '', text: `${company}: welcome, ${first}! Please finish your new-hire paperwork for ${ob.application.job.title}${start}: ${link}` }
    : { subject: `Welcome to ${company} — your new-hire paperwork`, text: `Hi ${first},\n\nWelcome to ${company}! Please complete your new-hire steps for ${ob.application.job.title}${start}. It takes about 10 minutes on your phone: sign your documents, add an emergency contact and upload anything we ask for.\n\n${link}\n\nThis link is just for you, so please don’t share it. For your Form I-9, bring original identity and work-authorization documents on your first day.\n\nThank you,\n${company}` };
  const results: { channel: Channel; problem: string | null }[] = [];
  for (const ch of channels) results.push({ channel: ch, problem: await deliver(tdb, c, ch, msg(ch), { name: company, replyTo: user.email }, user.id) });
  const sent = results.filter((r) => !r.problem).map((r) => r.channel);
  if (sent.length) await tdb.onboarding.updateMany({ where: { id: ob.id }, data: { invitedAt: new Date() } });
  await logActivity(org.id, sent.length ? `Sent ${c.name} their onboarding link` : `Couldn’t send ${c.name} their onboarding link`, user.id);
  return { sent, problems: results.filter((r) => r.problem).map((r) => `${r.channel === 'sms' ? 'Text' : 'Email'}: ${r.problem}`) };
}

// ---- the new hire's side (from their private link) ----
type Link = { organizationId: string; candidateId: string; organization: Organization; candidate: { name: string } };

/** What the new hire sees: active onboardings and their steps, with who does each one. */
export async function workerOnboarding(orgId: string, candidateId: string) {
  const tdb = tenantDb(orgId);
  const obs = await tdb.onboarding.findMany({ where: { candidateId, status: { in: ['IN_PROGRESS', 'COMPLETE'] }, updatedAt: { gte: new Date(Date.now() - 30 * 864e5) } }, include: { steps: { orderBy: { position: 'asc' } }, application: { select: { job: { select: { title: true, client: { select: { name: true } } } } } } }, orderBy: { createdAt: 'desc' } });
  if (!obs.length) return [];
  const types = await verifiedTypes(tdb, candidateId);
  const docs = await tdb.signDocument.findMany({ where: { id: { in: obs.flatMap((o) => o.steps.map((s) => s.signDocumentId).filter(Boolean) as string[]) } }, select: { id: true, body: true, status: true } });
  return obs.map((o) => {
    const p = progress(o.steps.map(stepState), types);
    return {
      id: o.id, job: [o.application.job.title, o.application.job.client?.name].filter(Boolean).join(' — '), startDate: o.startDate ? ymd(o.startDate) : null, ready: p.ready,
      steps: o.steps.map((s) => {
        const doc = docs.find((d) => d.id === s.signDocumentId);
        return {
          id: s.id, kind: s.kind, label: s.label, hint: s.hint, required: s.required, done: p.isDone(stepState(s)), waived: s.status === 'WAIVED',
          mine: ['SIGN', 'UPLOAD', 'FORM'].includes(s.kind),
          blocked: s.kind === 'SIGN' && s.status === 'PENDING' && (!doc || doc.status === 'VOID' || hasBlanks(doc.body)) ? 'Your recruiter is finishing this document.' : null,
          contact: s.kind === 'FORM' && s.data ? (s.data as Record<string, string>) : null,
        };
      }),
    };
  });
}

async function workerStep(link: Link, stepId: string, kind: string) {
  const tdb = tenantDb(link.organizationId);
  const s = await tdb.onboardingStep.findFirst({ where: { id: stepId, kind, onboarding: { candidateId: link.candidateId, status: { not: 'CANCELLED' } } } });
  if (!s) throw new HttpError(404, 'That step isn’t on your list.');
  return { tdb, s };
}

/** Opens a document to sign: issues a fresh one-time signing link for it. */
export async function openSign(link: Link, stepId: string, backToken: string) {
  const { tdb, s } = await workerStep(link, stepId, 'SIGN');
  if (s.status !== 'PENDING') throw new HttpError(409, 'You’ve already signed this.');
  const doc = s.signDocumentId ? await tdb.signDocument.findFirst({ where: { id: s.signDocumentId } }) : null;
  if (!doc || doc.status === 'VOID') throw new HttpError(409, 'This document was withdrawn. Your recruiter will send a new one.');
  if (doc.status === 'SIGNED') { await markSigned(link.organizationId, doc.id); throw new HttpError(409, 'You’ve already signed this.'); }
  if (hasBlanks(doc.body)) throw new HttpError(409, 'Your recruiter is finishing this document. Check back soon.');
  const token = newToken();
  const audit = [...(doc.audit as object[]), { at: new Date().toISOString(), event: 'sent', via: 'onboarding link', to: link.candidate.name }];
  await tdb.signDocument.updateMany({ where: { id: doc.id }, data: { status: 'SENT', tokenHash: sha256(token), tokenExpiresAt: new Date(Date.now() + 2 * 864e5), bodySha256: sha256(doc.body), audit } });
  return { url: `/sign/${token}?back=${encodeURIComponent(`/shifts/${backToken}`)}` };
}

/** Called when any document is signed: completes the onboarding step it belongs to. */
export async function markSigned(orgId: string, signDocumentId: string) {
  const tdb = tenantDb(orgId);
  const steps = await tdb.onboardingStep.findMany({ where: { signDocumentId, status: 'PENDING' }, select: { id: true, onboardingId: true } });
  if (!steps.length) return;
  await tdb.onboardingStep.updateMany({ where: { id: { in: steps.map((s) => s.id) } }, data: { status: 'DONE', completedAt: new Date(), completedBy: 'worker' } });
  for (const id of new Set(steps.map((s) => s.onboardingId))) await recompute(tdb, id);
}

export const EmergencyContact = z.object({
  name: z.string().trim().min(2, 'Enter your contact’s name.').max(100),
  relationship: z.string().trim().min(2, 'Say how you know them (e.g. spouse, parent).').max(50),
  phone: z.string().trim().refine((p) => p.replace(/\D/g, '').length >= 10, 'Enter a phone number with area code.').refine((p) => p.length <= 30),
});

export async function saveForm(link: Link, stepId: string, data: unknown) {
  const { tdb, s } = await workerStep(link, stepId, 'FORM');
  const r = EmergencyContact.safeParse(data);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Check the form.');
  await tdb.onboardingStep.updateMany({ where: { id: s.id }, data: { data: r.data, status: 'DONE', completedAt: new Date(), completedBy: 'worker' } });
  await recompute(tdb, s.onboardingId);
}

const UPLOAD_TYPES: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
/** A new hire's upload. When the step names a credential type, it's filed as that credential for staff to verify. */
export async function saveUpload(link: Link, stepId: string, file: File) {
  const { tdb, s } = await workerStep(link, stepId, 'UPLOAD');
  if (!file.size) throw new HttpError(400, 'Choose a file.');
  if (file.size > 10 * 1024 * 1024) throw new HttpError(413, 'That file is larger than 10 MB.');
  const type = UPLOAD_TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''];
  if (!type) throw new HttpError(415, 'Upload a PDF or a photo (JPG or PNG).');
  const stored = await putFile(link.organizationId, file.name, type, Buffer.from(await file.arrayBuffer()));
  const credentialType = (s.config as { credentialType?: string | null }).credentialType;
  if (credentialType) await tdb.credential.create({ data: { candidateId: link.candidateId, type: credentialType, fileId: stored.id, notes: 'Uploaded by the new hire during onboarding — add dates and verify.' } as never });
  await tdb.onboardingStep.updateMany({ where: { id: s.id }, data: { fileId: stored.id, status: 'DONE', completedAt: new Date(), completedBy: 'worker' } });
  await logActivity(link.organizationId, `${link.candidate.name} uploaded ${s.label.replace(/^Upload (your )?/i, '')} during onboarding`);
  await recompute(tdb, s.onboardingId);
}

/** Open required onboarding for a candidate, for warnings when scheduling or placing them. */
export async function onboardingGaps(tdb: TenantDb, candidateId: string) {
  const obs = await tdb.onboarding.findMany({ where: { candidateId, status: 'IN_PROGRESS' }, include: { steps: true } });
  if (!obs.length) return null;
  const types = await verifiedTypes(tdb, candidateId);
  const left = obs.reduce((n, o) => n + progress(o.steps.map(stepState), types).requiredLeft, 0);
  return left ? { left, packages: obs.map((o) => o.packageName) } : null;
}
