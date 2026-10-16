import { z } from 'zod';
import type { HiringDocument, Organization, Role } from '@prisma/client';
import { HttpError, logActivity, tenantDb, type TenantDb } from './tenant';
import { newToken, sha256 } from './tokens';
import { putFile, getFile } from './storage';
import { deliver, type Channel } from './schedule-server';
import { audit } from './audit';
import { imageType } from './employee-hub';
import { HIRING_DOCS, MAX_DOC_BYTES, isHiringDocKind, type HiringDocKind } from './hiring-docs';

/**
 * Hiring documents a candidate sends back. HR asks for them (with an offer, from an onboarding step or on their own);
 * the candidate uploads from their private page; HR accepts each one or sends it back with a reason. Files of sensitive
 * kinds (I-9 documents, tax and bank forms) can only be opened by owners and admins, and every opening is audited.
 */
const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';
type DocFile = { fileId: string; name: string; size: number; at: string };
const filesOf = (d: { files: unknown }) => (Array.isArray(d.files) ? (d.files as DocFile[]) : []);
const isAdmin = (r: Role) => r === 'OWNER' || r === 'ADMIN';
const OPEN = ['REQUESTED', 'RECEIVED', 'ACCEPTED'];

export const RequestBody = z.object({
  kinds: z.array(z.string()).max(12).default([]),
  other: z.string().trim().max(80, 'Keep the document name under 80 characters.').optional(),
  channels: z.array(z.enum(['email', 'sms'])).max(2).default([]),
});

/**
 * Asks a candidate for documents. Anything already asked for (and not sent back) is skipped. With channels, they get a
 * link to their page by email and/or text right away; with an offer, they're taken there after signing.
 */
export async function requestDocs(tdb: TenantDb, org: Organization, user: { id: string; email: string }, candidateId: string, body: unknown, opts: { signDocumentId?: string } = {}) {
  const r = RequestBody.safeParse(body ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Choose the documents to ask for.');
  const kinds = [...new Set(r.data.kinds)].filter((k) => k !== 'other');
  if (kinds.some((k) => !isHiringDocKind(k))) throw new HttpError(400, 'Choose documents from the list.');
  if (!kinds.length && !r.data.other) throw new HttpError(400, 'Choose at least one document to ask for.');
  const c = await tdb.candidate.findFirst({ where: { id: candidateId }, select: { id: true, name: true, email: true, phone: true, emailOptOut: true, smsOptOut: true } });
  if (!c) throw new HttpError(404, 'That candidate was deleted.');
  const have = await tdb.hiringDocument.findMany({ where: { candidateId, status: { in: OPEN } }, select: { kind: true, label: true } });
  const wanted: { kind: HiringDocKind; label: string }[] = [
    ...(kinds as HiringDocKind[]).map((k) => ({ kind: k, label: HIRING_DOCS[k].label })),
    ...(r.data.other ? [{ kind: 'other' as const, label: r.data.other }] : []),
  ];
  const fresh = wanted.filter((w) => !have.some((h) => h.kind === w.kind && (w.kind !== 'other' || h.label.toLowerCase() === w.label.toLowerCase())));
  for (const w of fresh) {
    await tdb.hiringDocument.create({ data: { candidateId, kind: w.kind, label: w.label, sensitive: HIRING_DOCS[w.kind].sensitive, requestedById: user.id, signDocumentId: opts.signDocumentId ?? null } as never });
  }
  if (fresh.length) await logActivity(org.id, `Asked ${c.name} for ${fresh.map((f) => f.label).join(', ')}`, user.id);
  let problems: string[] = [], sent: Channel[] = [];
  if (r.data.channels.length && (fresh.length || wanted.length)) ({ problems, sent } = await sendDocsLink(tdb, org, c, r.data.channels, user));
  return { requested: fresh.length, skipped: wanted.length - fresh.length, sent, problems };
}

/** A private link to the candidate's page, where they send what's asked for. Earlier links keep working until they expire. */
export async function docsLink(tdb: TenantDb, candidateId: string, days = 30) {
  const token = newToken();
  await tdb.workerLink.create({ data: { candidateId, tokenHash: sha256(token), kind: 'documents', expiresAt: new Date(Date.now() + days * 864e5) } as never });
  return token;
}

type Person = { id: string; name: string; email: string | null; phone: string | null; emailOptOut: boolean; smsOptOut: boolean };
export async function sendDocsLink(tdb: TenantDb, org: Organization, c: Person, channels: Channel[], user: { id: string; email: string }) {
  const open = await tdb.hiringDocument.findMany({ where: { candidateId: c.id, status: { in: ['REQUESTED', 'REJECTED'] } }, orderBy: { createdAt: 'asc' } });
  if (!open.length) return { sent: [] as Channel[], problems: ['Nothing is waiting to be sent.'] };
  const link = `${appUrl()}/shifts/${await docsLink(tdb, c.id)}#documents`, company = org.shortName ?? org.name, first = c.name.split(' ')[0] || 'there';
  const list = open.map((d) => `- ${d.label}${d.status === 'REJECTED' && d.note ? ` (please send it again: ${d.note})` : ''}`).join('\n');
  const msg = (ch: Channel) => ch === 'sms'
    ? { subject: '', text: `${company}: please send your hiring documents (${open.length}) securely here: ${link}` }
    : { subject: `${company}: documents we need from you`, text: `Hi ${first},\n\nPlease send us these documents:\n\n${list}\n\nUpload them securely here — a photo from your phone is fine:\n\n${link}\n\nPlease don’t send them by email or text. This link is just for you, so please don’t share it.\n\nThank you,\n${company}` };
  const problems: string[] = [], sent: Channel[] = [];
  for (const ch of channels) {
    const p = await deliver(tdb, c, ch, msg(ch), { name: company, replyTo: user.email }, user.id);
    if (p) problems.push(`${ch === 'sms' ? 'Text' : 'Email'}: ${p}`); else sent.push(ch);
  }
  return { sent, problems };
}

/** Everything asked for and sent, for the candidate's record. File names only; opening one is a separate, checked request. */
export async function candidateDocs(tdb: TenantDb, candidateId: string, role: Role) {
  const rows = await tdb.hiringDocument.findMany({ where: { candidateId }, orderBy: [{ createdAt: 'asc' }] });
  return rows.map((d) => ({
    id: d.id, kind: d.kind, label: d.label, sensitive: d.sensitive, status: d.status, note: d.note, viaOffer: !!d.signDocumentId, viaOnboarding: !!d.onboardingStepId,
    receivedAt: d.receivedAt?.toISOString() ?? null, reviewedAt: d.reviewedAt?.toISOString() ?? null, canOpen: !d.sensitive || isAdmin(role),
    files: filesOf(d).map((f) => ({ id: f.fileId, name: f.name, size: f.size, at: f.at })),
  }));
}

/** What the candidate sees on their page (onboarding uploads stay in their onboarding checklist). */
export async function workerDocs(orgId: string, candidateId: string) {
  const rows = await tenantDb(orgId).hiringDocument.findMany({ where: { candidateId, onboardingStepId: null, OR: [{ status: { in: ['REQUESTED', 'RECEIVED', 'REJECTED'] } }, { reviewedAt: { gte: new Date(Date.now() - 30 * 864e5) } }] }, orderBy: { createdAt: 'asc' } });
  return rows.map((d) => {
    const def = HIRING_DOCS[d.kind as HiringDocKind] ?? HIRING_DOCS.other;
    return { id: d.id, label: d.label, hint: def.hint || null, link: 'link' in def ? def.link : null, sensitive: d.sensitive, status: d.status, note: d.note, maxFiles: def.maxFiles, files: filesOf(d).map((f) => ({ id: f.fileId, name: f.name })) };
  });
}

/** PDF, JPEG or PNG, by the file's first bytes. */
export function docType(b: Buffer): string | null {
  if (b.length > 4 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return imageType(b);
}

async function storeFile(orgId: string, file: File) {
  if (!file.size) throw new HttpError(400, 'Choose a file.');
  if (file.size > MAX_DOC_BYTES) throw new HttpError(413, 'That file is larger than 10 MB. Try a photo instead of a scan, or a smaller PDF.');
  const buf = Buffer.from(await file.arrayBuffer());
  const type = docType(buf);
  if (!type) throw new HttpError(415, 'Send a PDF or a photo (JPG or PNG).');
  const ext = type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : 'jpg';
  const name = (file.name || `document.${ext}`).replace(/[^\w.\- ]/g, '_').slice(-80);
  const stored = await putFile(orgId, name, type, buf);
  return { fileId: stored.id, name, size: buf.length, at: new Date().toISOString() } satisfies DocFile;
}

/** One open "review hiring documents" task per candidate. */
async function reviewTask(tdb: TenantDb, candidateId: string, name: string) {
  const related = `docs:${candidateId}`;
  if (await tdb.task.findFirst({ where: { related, done: false } })) return;
  await tdb.task.create({ data: { title: `Review hiring documents from ${name}`, related, priority: 'Normal', dueAt: new Date(Date.now() + 2 * 864e5) } as never });
}
async function closeReviewTask(tdb: TenantDb, candidateId: string) {
  if (await tdb.hiringDocument.count({ where: { candidateId, status: 'RECEIVED' } })) return;
  await tdb.task.updateMany({ where: { related: `docs:${candidateId}`, done: false }, data: { done: true, doneAt: new Date() } });
}

type Link = { organizationId: string; candidateId: string; candidate: { name: string } };

/** The candidate sends a file for one of the documents asked for. */
export async function uploadDoc(link: Link, docId: string, file: File) {
  const tdb = tenantDb(link.organizationId);
  const d = await tdb.hiringDocument.findFirst({ where: { id: docId, candidateId: link.candidateId, onboardingStepId: null } });
  if (!d) throw new HttpError(404, 'That document isn’t on your list.');
  if (d.status === 'ACCEPTED') throw new HttpError(409, 'This one is already accepted. Thank you!');
  const max = (HIRING_DOCS[d.kind as HiringDocKind] ?? HIRING_DOCS.other).maxFiles;
  const files = d.status === 'REJECTED' ? [] : filesOf(d); // sent back: start over
  if (files.length >= max) throw new HttpError(409, `You can send up to ${max} file${max === 1 ? '' : 's'} for this. Remove one first.`);
  const f = await storeFile(link.organizationId, file);
  await tdb.hiringDocument.updateMany({ where: { id: d.id }, data: { files: [...files, f], status: 'RECEIVED', receivedAt: new Date(), note: null } });
  if (d.status === 'REJECTED') await dropFiles(tdb, filesOf(d));
  await reviewTask(tdb, link.candidateId, link.candidate.name);
  await logActivity(link.organizationId, `${link.candidate.name} sent ${d.label}`);
  return { message: `Sent. Thank you — we’ll let you know if we need anything else.` };
}

/** The candidate takes back a file they sent by mistake (until it's accepted). */
export async function removeDocFile(link: Link, docId: string, fileId: string) {
  const tdb = tenantDb(link.organizationId);
  const d = await tdb.hiringDocument.findFirst({ where: { id: docId, candidateId: link.candidateId, onboardingStepId: null } });
  if (!d || !filesOf(d).some((f) => f.fileId === fileId)) throw new HttpError(404, 'That file isn’t here any more.');
  if (d.status === 'ACCEPTED') throw new HttpError(409, 'This one is already accepted.');
  const files = filesOf(d).filter((f) => f.fileId !== fileId);
  await tdb.hiringDocument.updateMany({ where: { id: d.id }, data: { files, status: files.length ? 'RECEIVED' : 'REQUESTED', receivedAt: files.length ? d.receivedAt : null } });
  await dropFiles(tdb, filesOf(d).filter((f) => f.fileId === fileId));
  await closeReviewTask(tdb, link.candidateId);
  return { message: 'Removed.' };
}

async function dropFiles(tdb: TenantDb, files: DocFile[]) {
  if (files.length) await tdb.storedFile.deleteMany({ where: { id: { in: files.map((f) => f.fileId) } } });
}

/** An onboarding upload step: the file is filed as a hiring document too, so it's reviewed in the same place. */
export async function fileOnboardingUpload(tdb: TenantDb, orgId: string, step: { id: string; label: string; config: unknown }, candidate: { id: string; name: string }, file: File) {
  const kind = ((step.config as { docKind?: string }).docKind ?? 'other') as HiringDocKind;
  const def = HIRING_DOCS[isHiringDocKind(kind) ? kind : 'other'];
  const f = await storeFile(orgId, file);
  const d = await tdb.hiringDocument.findFirst({ where: { onboardingStepId: step.id } });
  if (d) {
    const files = d.status === 'REJECTED' ? [] : filesOf(d);
    if (files.length >= def.maxFiles) { await dropFiles(tdb, [f]); throw new HttpError(409, `You can send up to ${def.maxFiles} files for this step.`); }
    await tdb.hiringDocument.updateMany({ where: { id: d.id }, data: { files: [...files, f], status: 'RECEIVED', receivedAt: new Date(), note: null } });
    if (d.status === 'REJECTED') await dropFiles(tdb, filesOf(d));
  } else {
    await tdb.hiringDocument.create({ data: { candidateId: candidate.id, kind: isHiringDocKind(kind) ? kind : 'other', label: step.label, sensitive: def.sensitive, onboardingStepId: step.id, files: [f], status: 'RECEIVED', receivedAt: new Date() } as never });
  }
  await reviewTask(tdb, candidate.id, candidate.name);
  return f;
}

export const ReviewBody = z.object({ action: z.enum(['accept', 'reject']), note: z.string().trim().max(300, 'Keep the reason under 300 characters.').optional(), channels: z.array(z.enum(['email', 'sms'])).max(2).default([]) });

/** Accept a document, or send it back with a reason (the candidate is asked again; an onboarding step reopens). */
export async function reviewDoc(tdb: TenantDb, org: Organization, user: { id: string; email: string }, id: string, body: unknown) {
  const r = ReviewBody.safeParse(body ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Choose accept or send back.');
  const d = await tdb.hiringDocument.findFirst({ where: { id }, include: { candidate: { select: { id: true, name: true, email: true, phone: true, emailOptOut: true, smsOptOut: true } } } });
  if (!d) throw new HttpError(404, 'That document was deleted.');
  if (r.data.action === 'accept') {
    if (!filesOf(d).length) throw new HttpError(409, 'Nothing has been sent for this yet.');
    await tdb.hiringDocument.updateMany({ where: { id }, data: { status: 'ACCEPTED', reviewedAt: new Date(), reviewedById: user.id, note: null } });
    await logActivity(org.id, `Accepted ${d.candidate.name}’s ${d.label}`, user.id);
    await closeReviewTask(tdb, d.candidateId);
    return { ok: true, sent: [] as Channel[], problems: [] as string[] };
  }
  if (!r.data.note || r.data.note.length < 3) throw new HttpError(400, 'Say what’s wrong, so they know what to send instead.');
  await tdb.hiringDocument.updateMany({ where: { id }, data: { status: 'REJECTED', note: r.data.note, reviewedAt: new Date(), reviewedById: user.id } });
  if (d.onboardingStepId) {
    await tdb.onboardingStep.updateMany({ where: { id: d.onboardingStepId }, data: { status: 'PENDING', completedAt: null, completedBy: null, note: `Please send it again: ${r.data.note}` } });
    const step = await tdb.onboardingStep.findFirst({ where: { id: d.onboardingStepId }, select: { onboardingId: true } });
    if (step) { const { recompute } = await import('./onboarding-server'); await recompute(tdb, step.onboardingId); }
  }
  await logActivity(org.id, `Sent back ${d.candidate.name}’s ${d.label}: ${r.data.note}`, user.id);
  await closeReviewTask(tdb, d.candidateId);
  const res = r.data.channels.length ? await sendDocsLink(tdb, org, d.candidate, r.data.channels, user) : { sent: [] as Channel[], problems: [] as string[] };
  return { ok: true, ...res };
}

/** Withdraw a request that's no longer needed (nothing sent yet). */
export async function cancelDoc(tdb: TenantDb, org: Organization, user: { id: string }, id: string) {
  const d = await tdb.hiringDocument.findFirst({ where: { id }, include: { candidate: { select: { name: true } } } });
  if (!d) throw new HttpError(404, 'That request was already removed.');
  if (filesOf(d).length || d.onboardingStepId) throw new HttpError(409, d.onboardingStepId ? 'This is part of their onboarding. Waive the step there instead.' : 'They’ve already sent this. Accept it or send it back instead.');
  await tdb.hiringDocument.deleteMany({ where: { id } });
  await logActivity(org.id, `Withdrew the request for ${d.candidate.name}’s ${d.label}`, user.id);
  return { ok: true };
}

/** Opens one file. Sensitive kinds are for owners and admins only, and every opening goes in the audit log. */
export async function openDocFile(ctx: { tdb: TenantDb; org: Organization; role: Role; user: { id: string; email: string } }, id: string, fileId: string, req?: Request) {
  const d: (HiringDocument & { candidate: { name: string } }) | null = await ctx.tdb.hiringDocument.findFirst({ where: { id }, include: { candidate: { select: { name: true } } } });
  const f = d && filesOf(d).find((x) => x.fileId === fileId);
  if (!d || !f) throw new HttpError(404, 'That file was removed.');
  if (d.sensitive && !isAdmin(ctx.role)) throw new HttpError(403, 'Only owners and admins can open tax, bank and identity documents.');
  const stored = await ctx.tdb.storedFile.findFirst({ where: { id: f.fileId } });
  if (!stored) throw new HttpError(404, 'That file was removed.');
  if (d.sensitive) await audit(ctx.org.id, ctx.user, 'document.view', `Opened ${d.candidate.name}’s ${d.label} (${f.name})`, { targetType: 'hiringDocument', targetId: d.id, req });
  return { body: await getFile(stored.key), type: stored.contentType, name: f.name };
}
