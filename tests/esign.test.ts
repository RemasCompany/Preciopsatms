import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const mail = vi.hoisted(() => ({ sent: [] as { to: unknown; text: string }[], fail: false }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: { to: unknown; text: string }) => { if (mail.fail) throw new Error('smtp down'); mail.sent.push(o); return { id: 'x' }; }) }));
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
import { POST as CREATE } from '@/app/api/esign/route';
import { GET, PATCH } from '@/app/api/esign/[id]/route';
import { POST as SEND } from '@/app/api/esign/[id]/send/route';
import { POST as COUNTER } from '@/app/api/esign/[id]/countersign/route';
import { GET as PDF } from '@/app/api/esign/[id]/pdf/route';
import { GET as SIGN_GET, POST as SIGN } from '@/app/api/sign/[token]/route';

const RUN = `e${Date.now()}`;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let org: string, other: string, cand: string, recruiter: string, admin: string, outsider: string;
const as = (id: string, o = org) => { session.current = { user: { id, orgId: o } }; };
const req = (body?: object) => new Request('http://x', { method: 'POST', body: body ? JSON.stringify(body) : undefined });
const p = (id: string) => ({ params: { id } });
const tokenFrom = () => mail.sent.at(-1)!.text.match(/\/sign\/([\w-]+)/)![1];

beforeAll(async () => {
  process.env.APP_URL = 'http://localhost:3000';
  org = (await db.organization.create({ data: { name: 'Sign Co', slug: `e-${RUN}`, plan: 'growth', subscriptionStatus: 'active', ownerName: 'Pat', ownerTitle: 'CEO' } })).id;
  other = (await db.organization.create({ data: { name: 'Other', slug: `f-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  cand = (await db.candidate.create({ data: { organizationId: org, name: 'Sam Signer', email: 'sam@x.test' } })).id;
  for (const [role, o, set] of [['RECRUITER', org, (id: string) => (recruiter = id)], ['ADMIN', org, (id: string) => (admin = id)], ['OWNER', other, (id: string) => (outsider = id)]] as const) {
    const u = await db.user.create({ data: { email: `${role}-${o}@${RUN}.test`, passwordHash: 'x' } });
    await db.membership.create({ data: { userId: u.id, organizationId: o, role } });
    set(u.id);
  }
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('e-signature lifecycle', () => {
  let id: string;

  it('creates a draft from a template and refuses to send it with blanks left', async () => {
    as(recruiter);
    const res = await CREATE(req({ type: 'offer', relatedType: 'candidate', relatedId: cand }));
    expect(res.status).toBe(201);
    id = (await res.json()).document.id;
    const send = await SEND(req(), p(id));
    expect(send.status).toBe(400);
    expect((await send.json()).error).toMatch(/\{\{braces\}\}/);
  });

  it('never exposes the token hash', async () => {
    as(recruiter);
    const { document } = await (await GET(req(), p(id))).json();
    expect(document).not.toHaveProperty('tokenHash');
  });

  it('rolls back to draft when the signing email fails', async () => {
    as(recruiter);
    expect((await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ body: 'Plain terms. Sign below.' }) }), p(id))).status).toBe(200);
    mail.fail = true;
    const res = await SEND(req(), p(id));
    mail.fail = false;
    expect(res.status).toBe(502);
    expect(await db.signDocument.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'DRAFT', tokenHash: null });
  });

  it('sends, locks edits, and lets the signer sign once', async () => {
    as(recruiter);
    expect((await SEND(req(), p(id))).status).toBe(200);
    expect((await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ body: 'changed' }) }), p(id))).status).toBe(409);
    const token = tokenFrom();
    session.current = null;
    expect((await SIGN_GET(req(), { params: { token } })).status).toBe(200);
    expect((await SIGN(req({ name: 'Sam Signer', signature: PNG, consent: true }), { params: { token } })).status).toBe(200);
    expect((await SIGN(req({ name: 'Sam Signer', signature: PNG, consent: true }), { params: { token } })).status).toBe(404);
    expect((await db.signDocument.findUniqueOrThrow({ where: { id } })).status).toBe('SIGNED');
  });

  it('only admins countersign; a signed document can’t be voided', async () => {
    as(recruiter);
    expect((await COUNTER(req({ name: 'Rae Recruiter', signature: PNG, consent: true }), p(id))).status).toBe(403);
    expect((await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ action: 'void' }) }), p(id))).status).toBe(409);
    as(admin);
    expect((await COUNTER(req({ name: 'Ada Admin', signature: PNG }), p(id))).status).toBe(400);
    const res = await COUNTER(req({ name: 'Ada Admin', signature: PNG, consent: true }), p(id));
    expect(res.status).toBe(200);
    const doc = await db.signDocument.findUniqueOrThrow({ where: { id } });
    expect(doc).toMatchObject({ status: 'COUNTERSIGNED', counterName: 'Ada Admin' });
    expect((doc.audit as { event: string }[]).map((a) => a.event)).toEqual(['created', 'edited', 'sent', 'viewed', 'signed', 'countersigned']);
    expect(mail.sent.at(-1)!.to).toBe('sam@x.test');
    expect((await COUNTER(req({ name: 'Ada Admin', signature: PNG, consent: true }), p(id))).status).toBe(409);
  });

  it('downloads the PDF for the owning org only', async () => {
    as(admin);
    const res = await PDF(req(), p(id));
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    as(outsider, other);
    expect((await PDF(req(), p(id))).status).toBe(404);
    expect((await GET(req(), p(id))).status).toBe(404);
  });

  it('voids an unsigned document and kills its link', async () => {
    as(recruiter);
    const { document } = await (await CREATE(req({ type: 'custom', relatedType: 'candidate', relatedId: cand, body: 'Short note.' }))).json();
    await SEND(req(), p(document.id));
    const token = tokenFrom();
    expect((await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ action: 'void' }) }), p(document.id))).status).toBe(200);
    session.current = null;
    expect((await SIGN_GET(req(), { params: { token } })).status).toBe(404);
  });
});
