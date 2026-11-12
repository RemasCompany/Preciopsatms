import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const out = vi.hoisted(() => ({ texts: [] as { to: string; body: string }[], emails: [] as { to: string; subject: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (m: { to: string; subject: string }) => { out.emails.push(m); return { id: 'e' }; }) }));
vi.mock('@/lib/sms', () => ({ sendSms: vi.fn(async (to: string, body: string) => { out.texts.push({ to, body }); return { id: 's' }; }) }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { SKILLS_CHECKLISTS, checkAnswers, itemCount, itemKey, summarize } from '@/lib/skills-checklists';
import { GET as LIST, POST as SEND } from '@/app/api/checklists/route';
import { DELETE as CANCEL } from '@/app/api/checklists/[id]/route';
import { GET as PAGE } from '@/app/api/public/shifts/[token]/route';
import { POST as SUBMIT } from '@/app/api/public/checklists/[token]/route';

const all = (key: string, v: (s: number, i: number) => number) => Object.fromEntries(SKILLS_CHECKLISTS[key].sections.flatMap((sec, s) => sec.items.map((_, i) => [itemKey(s, i), v(s, i)])));

describe('skills checklist rules', () => {
  it('ships checklists with items in every section', () => {
    for (const [k, c] of Object.entries(SKILLS_CHECKLISTS)) {
      expect(c.sections.length, k).toBeGreaterThan(1);
      expect(c.sections.every((s) => s.items.length >= 4), k).toBe(true);
    }
  });
  it('needs every skill rated 1 to 4', () => {
    expect(checkAnswers('icu', all('icu', () => 3)).ok).toBe(true);
    const missing = all('icu', () => 3); delete missing['2.0'];
    expect(checkAnswers('icu', missing)).toEqual({ ok: false, error: 'Rate “Arterial lines” (Hemodynamics).' });
    expect(checkAnswers('icu', { ...all('icu', () => 3), '0.0': 5 }).ok).toBe(false);
    expect(checkAnswers('nope', {}).ok).toBe(false);
  });
  it('averages each section and lists what to plan orientation for', () => {
    const s = summarize('cna', all('cna', (sec, i) => (sec === 0 && i === 0 ? 1 : 4)));
    expect(s.sections[0].average).toBe(3.5);
    expect(s.needsSupport).toEqual(['Personal care: Bathing and oral care']);
  });
});

const RUN = `ck${Date.now()}`;
let org: string, other: string, rec: string, viewer: string, ana: string, quiet: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const json = (method: string, body?: unknown) => new Request('http://x', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const tokenFor = (phone: string) => out.texts.filter((t) => t.to === phone).at(-1)!.body.match(/\/shifts\/([\w-]+)/)![1];
const T = (token: string) => ({ params: { token } });

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Heart Staffing', slug: `h-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  other = (await db.organization.create({ data: { name: 'Other', slug: `o-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  rec = await u('rec'); viewer = await u('viewer');
  await db.membership.createMany({ data: [{ userId: rec, organizationId: org, role: 'RECRUITER' }, { userId: viewer, organizationId: org, role: 'VIEWER' }, { userId: rec, organizationId: other, role: 'RECRUITER' }] });
  ana = (await tenantDb(org).candidate.create({ data: { name: 'Ana Ruiz', phone: '+15550001111', email: 'ana@x.test' } as never })).id;
  quiet = (await tenantDb(org).candidate.create({ data: { name: 'Quiet Person', phone: '+15550002222', smsOptOut: true } as never })).id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('sending and filling out a checklist', () => {
  it('a recruiter sends it; viewers can’t, and opt-outs are honored', async () => {
    as(viewer);
    expect((await SEND(json('POST', { candidateId: ana, specialty: 'icu', channels: ['sms'] }))).status).toBe(403);
    as(rec);
    expect((await SEND(json('POST', { candidateId: ana, specialty: 'nope', channels: ['sms'] }))).status).toBe(400);
    expect((await SEND(json('POST', { candidateId: ana, specialty: 'icu', channels: ['sms', 'email'] }))).status).toBe(201);
    expect(out.texts.at(-1)!.body).toMatch(/Intensive Care \(ICU\) RN skills checklist/);
    expect(out.emails.at(-1)!.to).toBe('ana@x.test');
    const r = await SEND(json('POST', { candidateId: quiet, specialty: 'cna', channels: ['sms'] }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/opted out of texts/);
    expect(await db.message.count({ where: { organizationId: org, status: 'blocked_opt_out' } })).toBe(1);
    // Sending again re-sends the same open checklist.
    await SEND(json('POST', { candidateId: ana, specialty: 'icu', channels: ['sms'] }));
    expect(await tenantDb(org).skillsChecklist.count({ where: { candidateId: ana, status: 'SENT' } })).toBe(1);
  });

  it('shows on the worker’s page, and is signed and sent from there', async () => {
    const token = tokenFor('+15550001111');
    const page = await (await PAGE(new Request('http://x'), T(token))).json();
    expect(page.checklists.map((c: { title: string }) => c.title)).toEqual(['Intensive Care (ICU) RN']);
    const id = page.checklists[0].id;
    const answers = all('icu', (s, i) => (s === 2 && i === 4 ? 1 : 4));
    expect((await (await SUBMIT(json('POST', { checklistId: id, answers: { '0.0': 4 }, signedName: 'Ana Ruiz', attest: true }), T(token))).json()).error).toMatch(/^Rate /);
    expect((await (await SUBMIT(json('POST', { checklistId: id, answers, signedName: 'Ana Ruiz', attest: false }), T(token))).json()).error).toMatch(/accurate/);
    expect((await SUBMIT(json('POST', { checklistId: id, answers, signedName: 'Ana Ruiz', attest: true }), T(token))).status).toBe(200);
    expect((await SUBMIT(json('POST', { checklistId: id, answers, signedName: 'Ana Ruiz', attest: true }), T(token))).status).toBe(409);
    expect((await (await PAGE(new Request('http://x'), T(token))).json()).checklists).toEqual([]);
    as(rec);
    const list = (await (await LIST(new Request(`http://x?candidateId=${ana}`))).json()).checklists;
    expect(list[0]).toMatchObject({ status: 'COMPLETED', signedName: 'Ana Ruiz', expired: false, needsSupport: ['Hemodynamics: Intra-aortic balloon pump'] });
    expect(list[0].average).toBeCloseTo((itemCount('icu') * 4 - 3) / itemCount('icu'), 1);
    const one = new Date(); one.setUTCFullYear(one.getUTCFullYear() + 1);
    expect(list[0].expiresAt).toBe(one.toISOString().slice(0, 10));
  });

  it('can be cancelled before it’s done, and stays inside the company', async () => {
    as(rec);
    await SEND(json('POST', { candidateId: ana, specialty: 'er', channels: ['sms'] }));
    const open = (await tenantDb(org).skillsChecklist.findFirst({ where: { specialty: 'er' } }))!;
    as(rec, other);
    expect((await CANCEL(new Request('http://x', { method: 'DELETE' }), { params: { id: open.id } })).status).toBe(404);
    expect((await (await LIST(new Request(`http://x?candidateId=${ana}`))).json()).checklists).toEqual([]);
    as(rec);
    expect((await CANCEL(new Request('http://x', { method: 'DELETE' }), { params: { id: open.id } })).status).toBe(200);
    // A link from another company can't submit this one.
    expect((await SUBMIT(json('POST', { checklistId: open.id, answers: {}, signedName: 'Ana Ruiz', attest: true }), T('not-a-token'))).status).toBe(404);
  });
});
