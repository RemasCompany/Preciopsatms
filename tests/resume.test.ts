import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const ai = vi.hoisted(() => ({ prompts: [] as string[], reply: {} as Record<string, unknown> }));
const files = vi.hoisted(() => new Map<string, Buffer>());
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/ai', () => ({ aiJson: vi.fn(async (_o: unknown, prompt: string) => { ai.prompts.push(prompt); return ai.reply; }) }));
vi.mock('@/lib/storage', () => ({
  putFile: vi.fn(async (orgId: string, filename: string, contentType: string, body: Buffer) => {
    const { db } = await import('@/lib/db'); const key = `${orgId}/${Math.random()}`; files.set(key, body);
    return db.storedFile.create({ data: { organizationId: orgId, key, filename, contentType, size: body.length } });
  }),
  getFile: vi.fn(async (key: string) => files.get(key)!),
}));

import { db } from '@/lib/db';
import { cleanProfile, extractContact, extractResumeText, redactResume } from '@/lib/resume';
import { POST as PARSE } from '@/app/api/ai/parse-resume/route';
import { GET as DOWNLOAD, POST as UPLOAD } from '@/app/api/candidates/[id]/resume/route';

const RESUME = `MARIA J. LOPEZ
123 Palm Grove Ave, Apt 4, Orlando, FL 32801
maria.lopez@example.com | (407) 555-0142 | linkedin.com/in/marialopez

SUMMARY
Forklift operator with 7 years in high-volume distribution centers. Maria is OSHA certified.

EXPERIENCE
Lead Forklift Operator, Harbor Point Distribution — 2019–present
Operated sit-down and reach trucks; trained 12 new hires on RF scanners.

CERTIFICATIONS
OSHA Forklift Certification`;

async function pdf(text: string) {
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica); const page = doc.addPage([612, 792]);
  text.split('\n').forEach((l, i) => page.drawText(l.replace(/[—–]/g, '-'), { x: 50, y: 740 - i * 16, size: 11, font }));
  return Buffer.from(await doc.save());
}
async function docx(text: string) {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  z.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text.split('\n').map((l) => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return z.generateAsync({ type: 'nodebuffer' });
}

describe('resume text extraction', () => {
  it('reads PDF, Word and text files', async () => {
    for (const [buf, name] of [[await pdf(RESUME), 'r.pdf'], [await docx(RESUME), 'r.docx'], [Buffer.from(RESUME), 'r.txt']] as const) {
      const t = await extractResumeText(buf, name);
      expect(t, name).toContain('Lead Forklift Operator');
      expect(t, name).toContain('maria.lopez@example.com');
    }
  });
  it('explains what it can’t read', async () => {
    await expect(extractResumeText(Buffer.from('x'), 'old.doc')).rejects.toMatchObject({ status: 415 });
    await expect(extractResumeText(Buffer.from('x'), 'pic.png')).rejects.toMatchObject({ status: 415 });
    await expect(extractResumeText(await pdf(' '), 'scan.pdf')).rejects.toThrow(/scanned image/);
    await expect(extractResumeText(Buffer.from('%PDF-garbage'), 'bad.pdf')).rejects.toMatchObject({ status: 422 });
  });
});

describe('contact details stay local', () => {
  it('finds name, email and phone', () => {
    expect(extractContact(RESUME)).toEqual({ name: 'Maria J. Lopez', email: 'maria.lopez@example.com', phone: '(407) 555-0142' });
    expect(extractContact('Resume\nJohn Smith\njohn@x.test\n+1 407.555.0100').name).toBe('John Smith');
    expect(extractContact('Professional Summary\nWarehouse lead with 5 years').name).toBeNull();
  });
  it('redacts name, contact details, links and street address', () => {
    const r = redactResume(RESUME, 'Maria J. Lopez');
    for (const s of ['Maria', 'Lopez', 'maria.lopez@example.com', '555-0142', 'linkedin.com', '123 Palm Grove']) expect(r).not.toContain(s);
    expect(r).toContain('[name]'); expect(r).toContain('Lead Forklift Operator');
  });
  it('keeps only well-formed AI values', () => {
    const p = cleanProfile({ title: 'Forklift Operator', sector: 'Warehouse', yearsExp: '7.4', skills: ['RF scanner', 'RF scanner', 3, 'Reach truck'], certs: ['OSHA'], summary: '[name] runs forklifts.', location: '[address]' },
      { name: 'Maria Lopez', email: 'm@x.test', phone: null });
    expect(p).toEqual({ name: 'Maria Lopez', email: 'm@x.test', phone: null, title: 'Forklift Operator', location: null, sector: 'Warehouse', yearsExp: 7, skills: ['RF scanner', 'Reach truck'], certs: ['OSHA'], summary: 'The candidate runs forklifts.' });
    expect(cleanProfile({ sector: 'Space pirates', yearsExp: 200 }, { name: null, email: null, phone: null })).toMatchObject({ sector: null, yearsExp: null, skills: [] });
  });
});

const RUN = `r${Date.now()}`;
let org: string, cand: string, otherCand: string;
beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'R', slug: `r-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  cand = (await db.candidate.create({ data: { organizationId: org, name: 'Maria Lopez' } })).id;
  const o2 = await db.organization.create({ data: { name: 'O', slug: `o-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } });
  otherCand = (await db.candidate.create({ data: { organizationId: o2.id, name: 'Theirs' } })).id;
  const u = await db.user.create({ data: { email: `u@${RUN}.test`, passwordHash: 'x' } });
  await db.membership.create({ data: { userId: u.id, organizationId: org, role: 'RECRUITER' } });
  session.current = { user: { id: u.id, orgId: org } };
  ai.reply = { title: 'Lead Forklift Operator', location: 'Orlando, FL', sector: 'Warehouse', yearsExp: 7, skills: ['Sit-down forklift', 'RF scanner'], certs: ['OSHA Forklift Certification'], summary: 'Experienced operator.' };
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('parse-resume API', () => {
  const upload = async (buf: Buffer, name: string) => { const fd = new FormData(); fd.set('file', new File([buf], name)); return fd; };
  it('parses an uploaded PDF without sending contact details to the model', async () => {
    const res = await PARSE(new Request('http://x', { method: 'POST', body: await upload(await pdf(RESUME), 'maria.pdf') }));
    expect(res.status).toBe(200);
    expect((await res.json()).profile).toMatchObject({ name: 'Maria J. Lopez', email: 'maria.lopez@example.com', phone: '(407) 555-0142', title: 'Lead Forklift Operator', sector: 'Warehouse', yearsExp: 7 });
    const prompt = ai.prompts.at(-1)!;
    for (const s of ['Maria', 'Lopez', 'maria.lopez', '555-0142', 'linkedin', 'Palm Grove']) expect(prompt).not.toContain(s);
    expect(prompt).toContain('Harbor Point Distribution');
  });
  it('parses pasted text', async () => {
    const res = await PARSE(new Request('http://x', { method: 'POST', body: JSON.stringify({ text: RESUME }) }));
    expect((await res.json()).profile.certs).toEqual(['OSHA Forklift Certification']);
    expect((await PARSE(new Request('http://x', { method: 'POST', body: JSON.stringify({ text: 'too short' }) }))).status).toBe(400);
  });
  it('attaches, downloads and parses the resume on file — for the caller’s own candidates only', async () => {
    expect((await PARSE(new Request('http://x', { method: 'POST', body: JSON.stringify({ candidateId: cand }) }))).status).toBe(404);
    const up = await UPLOAD(new Request('http://x', { method: 'POST', body: await upload(await docx(RESUME), 'maria.docx') }), { params: { id: cand } });
    expect(await up.json()).toEqual({ ok: true, filename: 'maria.docx' });
    const dl = await DOWNLOAD(new Request('http://x'), { params: { id: cand } });
    expect(dl.headers.get('content-disposition')).toBe('attachment; filename="maria.docx"');
    expect((await PARSE(new Request('http://x', { method: 'POST', body: JSON.stringify({ candidateId: cand }) }))).status).toBe(200);
    expect((await UPLOAD(new Request('http://x', { method: 'POST', body: await upload(Buffer.from('x'), 'r.txt') }), { params: { id: otherCand } })).status).toBe(404);
    expect((await DOWNLOAD(new Request('http://x'), { params: { id: otherCand } })).status).toBe(404);
    expect((await UPLOAD(new Request('http://x', { method: 'POST', body: await upload(Buffer.from('x'), 'virus.exe') }), { params: { id: cand } })).status).toBe(415);
  });
});
