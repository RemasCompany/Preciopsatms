import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const out = vi.hoisted(() => ({ texts: [] as { to: string; body: string }[], emails: [] as { to: unknown; subject: string; text: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: { to: unknown; subject: string; text: string }) => { out.emails.push(o); return { id: 'e' }; }) }));
vi.mock('@/lib/sms', async (orig) => ({ ...(await orig<typeof import('@/lib/sms')>()), sendSms: vi.fn(async (to: string, body: string) => { out.texts.push({ to, body }); return { id: 's' }; }) }));
vi.mock('@/lib/storage', () => {
  const files = new Map<string, Buffer>();
  return {
    putFile: vi.fn(async (orgId: string, filename: string, contentType: string, body: Buffer) => {
      const { db } = await import('@/lib/db');
      const key = `${orgId}/${Math.random()}`; files.set(key, body);
      return db.storedFile.create({ data: { organizationId: orgId, key, filename, contentType, size: body.length } });
    }),
    getFile: vi.fn(async (key: string) => files.get(key)!),
  };
});

import { db } from '@/lib/db';
import { POST as REQUEST, GET as LIST } from '@/app/api/candidates/[id]/documents/route';
import { PATCH as REVIEW, DELETE as WITHDRAW } from '@/app/api/hiring-documents/[id]/route';
import { GET as OPEN } from '@/app/api/hiring-documents/[id]/file/route';
import { POST as SEND_FILE, DELETE as REMOVE_FILE } from '@/app/api/public/documents/[token]/route';
import { GET as PAGE } from '@/app/api/public/shifts/[token]/route';
import { POST as SEND_DOC } from '@/app/api/esign/[id]/send/route';
import { POST as SIGN } from '@/app/api/sign/[token]/route';
import { POST as ADD_PKG } from '@/app/api/onboarding/packages/route';
import { POST as START } from '@/app/api/onboarding/route';
import { POST as UPLOAD_STEP } from '@/app/api/public/onboarding/[token]/upload/route';
import { newToken, sha256 } from '@/lib/tokens';
import { docType } from '@/lib/hiring-docs-server';

const RUN = `hdoc${Date.now()}`;
let org: string, admin: string, recruiter: string, cand: string, job: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const json = (body: unknown, method = 'POST') => new Request('http://x', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const fileForm = (fields: Record<string, string>, bytes: Buffer, name: string) => {
  const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.set(k, v); fd.set('file', new File([new Uint8Array(bytes)], name));
  return new Request('http://x', { method: 'POST', body: fd });
};
const tokenIn = (text: string) => text.match(/\/shifts\/([\w-]+)/)![1];
const page = async (t: string) => (await PAGE(new Request('http://x'), { params: { token: t } })).json();

beforeAll(async () => {
  process.env.APP_URL = 'https://app.test';
  org = (await db.organization.create({ data: { name: 'Acme Staffing', shortName: 'Acme', slug: `hd-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  admin = (await db.user.create({ data: { email: `admin@${RUN}.test`, name: 'Ada Admin', passwordHash: 'x' } })).id;
  recruiter = (await db.user.create({ data: { email: `rec@${RUN}.test`, name: 'Rex Recruiter', passwordHash: 'x' } })).id;
  await db.membership.create({ data: { userId: admin, organizationId: org, role: 'ADMIN' } });
  await db.membership.create({ data: { userId: recruiter, organizationId: org, role: 'RECRUITER' } });
  cand = (await db.candidate.create({ data: { organizationId: org, name: 'Maria Lopez', email: 'maria@x.test', phone: '(305) 555-0100' } })).id;
  job = (await db.job.create({ data: { organizationId: org, title: 'Forklift Operator', type: 'TEMP' } })).id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('hiring documents', () => {
  let token: string;
  it('asks once per document and sends one secure link', async () => {
    as(recruiter);
    const res = await REQUEST(json({ kinds: ['i9_docs', 'w4', 'certifications'], other: 'Copy of OSHA 10 card', channels: ['email'] }), { params: { id: cand } });
    expect(await res.json()).toMatchObject({ requested: 4, skipped: 0, sent: ['email'] });
    const mail = out.emails.at(-1)!;
    expect(mail.subject).toBe('Acme: documents we need from you');
    expect(mail.text).toContain('- Identity and work authorization (Form I-9)\n- Form W-4 (federal tax withholding)');
    expect(mail.text).toContain('Please don’t send them by email or text.');
    expect(await db.message.count({ where: { organizationId: org, relatedId: cand, channel: 'email', status: 'sent' } })).toBe(1);
    // Asking again doesn't duplicate.
    expect(await (await REQUEST(json({ kinds: ['w4'] }), { params: { id: cand } })).json()).toMatchObject({ requested: 0, skipped: 1 });
    expect((await REQUEST(json({ kinds: ['ssn_card'] }), { params: { id: cand } })).status).toBe(400);
    token = tokenIn(mail.text);
    const docs = (await page(token)).documents;
    expect(docs.map((d: { label: string }) => d.label)).toEqual(['Identity and work authorization (Form I-9)', 'Form W-4 (federal tax withholding)', 'Licenses and certifications', 'Copy of OSHA 10 card']);
    expect(docs[0]).toMatchObject({ sensitive: true, status: 'REQUESTED', link: { href: expect.stringContaining('uscis.gov') } });
  });

  it('takes PDFs and photos by their contents, up to the limit, and lets them take one back', async () => {
    expect(docType(PDF)).toBe('application/pdf');
    expect(docType(Buffer.from('<html><script>'))).toBeNull();
    const docs = (await page(token)).documents as { id: string; label: string }[];
    const i9 = docs[0].id;
    const send = (bytes: Buffer, name: string, id = i9) => SEND_FILE(fileForm({ docId: id }, bytes, name), { params: { token } });
    expect((await send(Buffer.from('<html>'), 'id.pdf')).status).toBe(415);
    expect(await (await send(JPG, 'license-front.jpg')).json()).toMatchObject({ message: expect.stringContaining('Sent.') });
    await send(JPG, 'license-back.jpg'); await send(PDF, 'birth-cert.pdf'); await send(JPG, 'extra.jpg');
    expect((await send(JPG, 'too-many.jpg')).status).toBe(409); // four files at most for the I-9
    const d = (await page(token)).documents[0];
    expect(d).toMatchObject({ status: 'RECEIVED' });
    expect(d.files).toHaveLength(4);
    const extra = d.files.find((f: { name: string }) => f.name === 'extra.jpg');
    expect(await (await REMOVE_FILE(json({ docId: i9, fileId: extra.id }, 'DELETE'), { params: { token } })).json()).toEqual({ message: 'Removed.' });
    expect(await db.storedFile.count({ where: { id: extra.id } })).toBe(0);
    // HR gets one task to review them.
    await send(PDF, 'w4.pdf', docs[1].id);
    expect(await db.task.count({ where: { organizationId: org, related: `docs:${cand}`, done: false } })).toBe(1);
  });

  it('only owners and admins open tax, bank and identity documents, and every opening is audited', async () => {
    as(recruiter);
    const list = await (await LIST(new Request('http://x'), { params: { id: cand } })).json();
    const i9 = list[0], cert = list[2];
    expect(i9).toMatchObject({ sensitive: true, canOpen: false, status: 'RECEIVED' });
    expect((await OPEN(new Request(`http://x/?f=${i9.files[0].id}`), { params: { id: i9.id } })).status).toBe(403);
    as(admin);
    const r = await OPEN(new Request(`http://x/?f=${i9.files[0].id}`), { params: { id: i9.id } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/jpeg');
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(await db.auditLog.count({ where: { organizationId: org, action: 'document.view', targetId: i9.id } })).toBe(1);
    // Someone at another company can't reach it at all.
    const other = (await db.organization.create({ data: { name: 'Other', slug: `ot-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
    const stranger = (await db.user.create({ data: { email: `x@${RUN}.test`, passwordHash: 'x' } })).id;
    await db.membership.create({ data: { userId: stranger, organizationId: other, role: 'OWNER' } });
    as(stranger, other);
    expect((await OPEN(new Request(`http://x/?f=${i9.files[0].id}`), { params: { id: i9.id } })).status).toBe(404);
    expect((await REVIEW(json({ action: 'accept' }, 'PATCH'), { params: { id: i9.id } })).status).toBe(404);
    // Withdrawing works only before anything is sent.
    as(recruiter);
    expect((await WITHDRAW(new Request('http://x', { method: 'DELETE' }), { params: { id: i9.id } })).status).toBe(409);
    expect((await WITHDRAW(new Request('http://x', { method: 'DELETE' }), { params: { id: cert.id } })).status).toBe(200);
  });

  it('sends a document back with a reason; the next upload replaces it', async () => {
    as(recruiter);
    const [i9, w4] = await (await LIST(new Request('http://x'), { params: { id: cand } })).json();
    expect((await REVIEW(json({ action: 'reject', note: '' }, 'PATCH'), { params: { id: w4.id } })).status).toBe(400);
    const res = await REVIEW(json({ action: 'reject', note: 'Page 1 is missing your signature.', channels: ['sms'] }, 'PATCH'), { params: { id: w4.id } });
    expect(await res.json()).toMatchObject({ ok: true, sent: ['sms'] });
    expect(out.texts.at(-1)!.body).toMatch(/^Acme: please send your hiring documents \(\d\) securely here: https:\/\/app\.test\/shifts\/[\w-]+#documents$/);
    // Asking for it again doesn't make a second request: the one sent back is still open.
    expect(await (await REQUEST(json({ kinds: ['w4'] }), { params: { id: cand } })).json()).toMatchObject({ requested: 0, skipped: 1 });
    const back = (await page(token)).documents.find((d: { id: string }) => d.id === w4.id);
    expect(back).toMatchObject({ status: 'REJECTED', note: 'Page 1 is missing your signature.' });
    await SEND_FILE(fileForm({ docId: w4.id }, PDF, 'w4-signed.pdf'), { params: { token } });
    const again = (await (await LIST(new Request('http://x'), { params: { id: cand } })).json())[1];
    expect(again).toMatchObject({ status: 'RECEIVED', note: null });
    expect(again.files.map((f: { name: string }) => f.name)).toEqual(['w4-signed.pdf']);
    expect(await db.storedFile.count({ where: { id: w4.files[0].id } })).toBe(0); // the rejected file is gone
    await REVIEW(json({ action: 'accept' }, 'PATCH'), { params: { id: i9.id } });
    await REVIEW(json({ action: 'accept' }, 'PATCH'), { params: { id: w4.id } });
    expect(await db.task.count({ where: { related: `docs:${cand}`, done: false } })).toBe(0); // nothing left to review
    const sendAccepted = await SEND_FILE(fileForm({ docId: i9.id }, JPG, 'late.jpg'), { params: { token } });
    expect(sendAccepted.status).toBe(409);
  });
});

describe('documents with an offer', () => {
  it('asks for them when the offer goes out, and takes the signer there after signing', async () => {
    as(recruiter);
    const c = await db.candidate.create({ data: { organizationId: org, name: 'Sam Reed', email: 'sam@x.test' } });
    const doc = await db.signDocument.create({ data: { organizationId: org, type: 'offer', relatedType: 'candidate', relatedId: c.id, title: 'Offer letter — Sam Reed', body: 'We are pleased to offer you the job.', signerName: 'Sam Reed', signerEmail: 'sam@x.test' } });
    const sent = await SEND_DOC(json({ requestDocs: ['i9_docs', 'w4', 'direct_deposit'] }), { params: { id: doc.id } });
    expect(await sent.json()).toEqual({ ok: true, requested: 3 });
    const mail = out.emails.at(-1)!;
    expect(mail.subject).toBe('Please sign: Offer letter — Sam Reed');
    expect(mail.text).toContain('After you sign, you’ll be asked to upload a few hiring documents');
    expect(await db.hiringDocument.count({ where: { candidateId: c.id, signDocumentId: doc.id, status: 'REQUESTED' } })).toBe(3);
    const signToken = mail.text.match(/\/sign\/([\w-]+)/)![1];
    const signed = await (await SIGN(json({ name: 'Sam Reed', signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', consent: true }), { params: { token: signToken } })).json();
    expect(signed.next).toMatchObject({ count: 3, url: expect.stringMatching(/^\/shifts\/[\w-]+#documents$/) });
    const docs = (await page(signed.next.url.slice(8, -10))).documents;
    expect(docs.map((d: { label: string }) => d.label)).toEqual(['Identity and work authorization (Form I-9)', 'Form W-4 (federal tax withholding)', 'Direct deposit (voided check or bank letter)']);
  });
});

describe('documents during onboarding', () => {
  it('an onboarding upload is a hiring document: sent back, the step reopens', async () => {
    as(admin);
    const pkg = await (await ADD_PKG(json({ name: 'Paperwork', steps: [{ kind: 'UPLOAD', label: 'Send your completed Form W-4', docKind: 'w4', required: true }] }))).json();
    const c = await db.candidate.create({ data: { organizationId: org, name: 'Lee Park', email: 'lee@x.test' } });
    const app = await db.application.create({ data: { organizationId: org, candidateId: c.id, jobId: job, stage: 'OFFER', maxStage: 'OFFER' } });
    const ob = await (await START(json({ applicationId: app.id, packageId: pkg.id }))).json();
    const t = newToken();
    await db.workerLink.create({ data: { organizationId: org, candidateId: c.id, tokenHash: sha256(t), kind: 'onboarding', expiresAt: new Date(Date.now() + 864e5) } });
    const step = (await page(t)).onboarding[0].steps[0];
    expect(step).toMatchObject({ kind: 'UPLOAD', docKind: 'w4', done: false });
    expect((await UPLOAD_STEP(fileForm({ stepId: step.id }, PDF, 'w4.pdf'), { params: { token: t } })).status).toBe(200);
    const d = await db.hiringDocument.findFirstOrThrow({ where: { onboardingStepId: step.id } });
    expect(d).toMatchObject({ kind: 'w4', sensitive: true, status: 'RECEIVED' });
    expect((await page(t)).documents).toEqual([]); // it stays in the onboarding checklist
    await REVIEW(json({ action: 'reject', note: 'Please sign it.' }, 'PATCH'), { params: { id: d.id } });
    expect((await page(t)).onboarding[0].steps[0]).toMatchObject({ done: false, note: 'Please send it again: Please sign it.' });
    await UPLOAD_STEP(fileForm({ stepId: step.id }, PDF, 'w4-signed.pdf'), { params: { token: t } });
    expect((await page(t)).onboarding[0].steps[0]).toMatchObject({ done: true, note: null });
    expect((await db.hiringDocument.findFirstOrThrow({ where: { id: d.id } })).status).toBe('RECEIVED');
    expect(ob.id).toBeTruthy();
  });
});
