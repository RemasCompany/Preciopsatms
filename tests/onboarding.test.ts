import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const out = vi.hoisted(() => ({ texts: [] as { to: string; body: string }[], emails: [] as { to: unknown; subject: string; text: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: { to: unknown; subject: string; text: string }) => { out.emails.push(o); return { id: 'e' }; }) }));
vi.mock('@/lib/sms', () => ({ sendSms: vi.fn(async (to: string, body: string) => { out.texts.push({ to, body }); return { id: 's' }; }) }));
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
import { POST as ADD_PKG } from '@/app/api/onboarding/packages/route';
import { PATCH as EDIT_PKG } from '@/app/api/onboarding/packages/[id]/route';
import { POST as START } from '@/app/api/onboarding/route';
import { PATCH as OB } from '@/app/api/onboarding/[id]/route';
import { POST as INVITE } from '@/app/api/onboarding/[id]/invite/route';
import { PATCH as STEP } from '@/app/api/onboarding/steps/[id]/route';
import { POST as WORKER } from '@/app/api/public/onboarding/[token]/route';
import { POST as UPLOAD } from '@/app/api/public/onboarding/[token]/upload/route';
import { GET as PAGE } from '@/app/api/public/shifts/[token]/route';
import { POST as SIGN } from '@/app/api/sign/[token]/route';
import { PATCH as MOVE } from '@/app/api/applications/[id]/route';
import { POST as ADD_SHIFT } from '@/app/api/shifts/route';
import { PackageBody, STARTER_PACKAGES, i9Due, progress } from '@/lib/onboarding';

describe('onboarding rules', () => {
  it('validates packages with friendly errors', () => {
    const bad = PackageBody.safeParse({ name: 'X1', steps: [{ kind: 'SIGN', label: 'Policy', doc: 'custom' }] });
    expect(bad.success ? '' : bad.error.issues[0].message).toBe('“Policy” needs a document title and text.');
    expect(PackageBody.safeParse({ name: 'Ok', steps: [] }).error?.issues[0].message).toBe('Add at least one step.');
    for (const s of STARTER_PACKAGES) expect(PackageBody.safeParse(s).success).toBe(true);
  });
  it('dates the I-9 three business days after the start', () => {
    expect(i9Due('2026-10-05')).toBe('2026-10-08'); // Mon → Thu
    expect(i9Due('2026-10-09')).toBe('2026-10-14'); // Fri → Wed
  });
  it('counts a credential step done while the credential is verified', () => {
    const steps = [{ id: '1', kind: 'CREDENTIAL', label: 'RN', required: true, status: 'PENDING' as const, config: { credentialType: 'RN license' } }, { id: '2', kind: 'STAFF', label: 'I-9', required: false, status: 'PENDING' as const, config: {} }];
    expect(progress(steps, new Set()).ready).toBe(false);
    expect(progress(steps, new Set(['RN license']))).toMatchObject({ ready: true, done: 1, total: 2 });
  });
});

const RUN = `ob${Date.now()}`;
let org: string, other: string, lite: string, admin: string, rec: string, outsider: string, liteUser: string;
let cand: string, app: string, sourced: string, pkgId: string, obId: string, token: string, job: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const req = (method: string, body?: object) => new Request('http://x', { method, body: body ? JSON.stringify(body) : undefined });
const p = (id: string) => ({ params: { id } });
const t = (tok = token) => ({ params: { token: tok } });
const page = async () => (await (await PAGE(req('GET'), t())).json()).onboarding[0];

beforeAll(async () => {
  const mk = (n: string, plan: 'growth' | 'starter') => db.organization.create({ data: { name: `${n} Staffing`, shortName: n, slug: `${n}-${RUN}`, plan, subscriptionStatus: 'active', ownerName: 'Pat Owner', ownerTitle: 'President' } }).then((o) => o.id);
  [org, other, lite] = await Promise.all([mk('care', 'growth'), mk('other', 'growth'), mk('lite', 'starter')]);
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [admin, rec, outsider, liteUser] = await Promise.all([u('admin'), u('rec'), u('out'), u('lite')]);
  await db.membership.createMany({ data: [
    { userId: admin, organizationId: org, role: 'ADMIN' }, { userId: rec, organizationId: org, role: 'RECRUITER' },
    { userId: outsider, organizationId: other, role: 'OWNER' }, { userId: liteUser, organizationId: lite, role: 'OWNER' },
  ] });
  const client = await db.client.create({ data: { organizationId: org, name: 'St. Mary’s' } });
  job = (await db.job.create({ data: { organizationId: org, clientId: client.id, title: 'ICU RN', location: 'Austin, TX', type: 'CONTRACT', payRate: 58, billRate: 82 } })).id;
  cand = (await db.candidate.create({ data: { organizationId: org, name: 'Maria Garcia', email: 'maria@example.test', phone: '5125550101' } })).id;
  app = (await db.application.create({ data: { organizationId: org, candidateId: cand, jobId: job, stage: 'OFFER' } })).id;
  const c2 = await db.candidate.create({ data: { organizationId: org, name: 'Early Stage' } });
  sourced = (await db.application.create({ data: { organizationId: org, candidateId: c2.id, jobId: job, stage: 'SOURCED' } })).id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('packages', () => {
  it('admins add starter packages; recruiters and other plans can’t', async () => {
    as(liteUser, lite);
    expect((await ADD_PKG(req('POST', { starter: 1 }))).status).toBe(402);
    as(rec);
    expect((await ADD_PKG(req('POST', { starter: 1 }))).status).toBe(403);
    as(admin);
    const r = await ADD_PKG(req('POST', { starter: 1 }));
    expect(r.status).toBe(201);
    pkgId = (await r.json()).id;
    expect((await ADD_PKG(req('POST', { starter: 1 }))).status).toBe(409);
    // Trim it to something small for the rest of the tests.
    const steps = [
      { kind: 'SIGN', label: 'Sign your offer letter', doc: 'offer', required: true },
      { kind: 'FORM', label: 'Add an emergency contact', form: 'emergency_contact', required: true },
      { kind: 'UPLOAD', label: 'Upload your BLS card', credentialType: 'BLS', required: true },
      { kind: 'CREDENTIAL', label: 'Nursing license verified', credentialType: 'RN license', required: true },
      { kind: 'STAFF', label: 'Form I-9 completed', task: 'i9', required: true },
      { kind: 'STAFF', label: 'Drug screen cleared', task: 'drug_screen', required: false },
    ];
    expect((await EDIT_PKG(req('PATCH', { name: 'Healthcare new hire', steps }), p(pkgId))).status).toBe(200);
  });
});

describe('a new hire’s onboarding', () => {
  it('starts only for offers and placements, once per assignment', async () => {
    as(rec);
    const early = await START(req('POST', { applicationId: sourced, packageId: pkgId }));
    expect((await early.json()).error).toBe('Move Early Stage to Offer or Placed before starting onboarding.');
    const r = await START(req('POST', { applicationId: app, packageId: pkgId, startDate: '2026-10-05' }));
    expect(r.status).toBe(201);
    obId = (await r.json()).id;
    expect((await START(req('POST', { applicationId: app, packageId: pkgId }))).status).toBe(409);
    const doc = (await db.signDocument.findFirst({ where: { organizationId: org, relatedId: cand } }))!;
    expect(doc.status).toBe('DRAFT');
    expect(doc.body).toContain('October 5, 2026');
    expect(doc.body).toContain('$58 per hour');
  });

  it('sends the new hire one link', async () => {
    as(rec);
    out.texts = [];
    const r = await (await INVITE(req('POST', { channels: ['sms'] }), p(obId))).json();
    expect(r.sent).toEqual(['sms']);
    expect(out.texts[0].body).toMatch(/^care: welcome, Maria! Please finish your new-hire paperwork for ICU RN before you start on Monday, October 5: http.*\/shifts\//);
    token = out.texts[0].body.match(/\/shifts\/([\w-]+)/)![1];
    const view = await page();
    expect(view.steps.map((s: { label: string; mine: boolean; done: boolean }) => `${s.mine ? 'me' : 'staff'}:${s.done ? 'done' : 'todo'}`)).toEqual(['me:todo', 'me:todo', 'me:todo', 'staff:todo', 'staff:todo', 'staff:todo']);
  });

  it('lets the new hire sign, add a contact and upload from the link', async () => {
    const view = await page();
    const [signStep, formStep, uploadStep] = view.steps;
    const open = await (await WORKER(req('POST', { action: 'sign', stepId: signStep.id }), t())).json();
    expect(open.url).toMatch(new RegExp(`^/sign/[\\w-]+\\?back=%2Fshifts%2F${token}$`));
    const signToken = open.url.match(/^\/sign\/([\w-]+)/)[1];
    const signed = await SIGN(new Request('http://x', { method: 'POST', body: JSON.stringify({ name: 'Maria Garcia', signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', consent: true }) }), { params: { token: signToken } });
    expect(signed.status).toBe(200);
    expect((await WORKER(req('POST', { action: 'sign', stepId: signStep.id }), t())).status).toBe(409);

    const bad = await (await WORKER(req('POST', { action: 'form', stepId: formStep.id, data: { name: 'Luis Garcia', relationship: 'Spouse', phone: '555' } }), t())).json();
    expect(bad.error).toBe('Enter a phone number with area code.');
    expect((await WORKER(req('POST', { action: 'form', stepId: formStep.id, data: { name: 'Luis Garcia', relationship: 'Spouse', phone: '(512) 555-0199' } }), t())).status).toBe(200);

    const fd = new FormData(); fd.set('stepId', uploadStep.id); fd.set('file', new File([new Uint8Array([1, 2, 3])], 'bls.jpg', { type: 'image/jpeg' }));
    expect((await UPLOAD(new Request('http://x', { method: 'POST', body: fd }), t())).status).toBe(200);
    const bls = await db.credential.findFirst({ where: { organizationId: org, candidateId: cand, type: 'BLS' } });
    expect(bls).toMatchObject({ verifiedAt: null });
    expect(bls!.fileId).not.toBeNull();

    const after = await page();
    expect(after.steps.slice(0, 3).map((s: { done: boolean }) => s.done)).toEqual([true, true, true]);
    expect(after.ready).toBe(false);
  });

  it('warns when scheduling or placing someone who isn’t ready', async () => {
    as(rec);
    const place = await (await MOVE(req('PATCH', { stage: 'PLACED' }), p(app))).json();
    // The uploaded BLS card has no dates yet, so both problems are named.
    expect(place.warning).toBe('Check Maria Garcia’s credentials before they start — BLS: add expiration date; onboarding has 2 required steps left.');
    const s = await (await ADD_SHIFT(req('POST', { applicationId: app, dates: ['2026-10-05'], start: '07:00', end: '19:00', breakMinutes: 30 }))).json();
    expect(s.warnings).toContain('Onboarding isn’t finished: 2 required steps left (Healthcare new hire).');
  });

  it('staff finish their tasks; a verified credential completes its step; then it’s ready', async () => {
    as(rec);
    const steps = await db.onboardingStep.findMany({ where: { onboardingId: obId }, orderBy: { position: 'asc' } });
    const [, , , cred, i9, drug] = steps;
    expect((await (await STEP(req('PATCH', { action: 'done' }), p(cred.id))).json()).error).toMatch(/completes itself once the credential is verified/);
    expect((await (await STEP(req('PATCH', { action: 'waive' }), p(drug.id))).json()).error).toBe('Say why this step doesn’t apply.');
    expect((await STEP(req('PATCH', { action: 'waive', note: 'Client doesn’t require one' }), p(drug.id))).status).toBe(200);
    expect((await (await STEP(req('PATCH', { action: 'done' }), p(i9.id))).json()).ready).toBe(false);
    await db.credential.create({ data: { organizationId: org, candidateId: cand, type: 'RN license', number: 'RN1', state: 'TX', expiresAt: new Date('2028-01-01'), verifiedAt: new Date() } });
    const r = await (await STEP(req('PATCH', { action: 'reopen' }), p(drug.id))).json();
    expect(r.ready).toBe(true); // drug screen is optional, so reopening it doesn't matter
    expect((await db.onboarding.findUnique({ where: { id: obId } }))!.status).toBe('COMPLETE');
    const signStep = steps[0];
    expect((await STEP(req('PATCH', { action: 'reopen' }), p(signStep.id))).status).toBe(409);
    expect(await db.activity.count({ where: { organizationId: org, text: { contains: 'finished onboarding' } } })).toBe(1);
  });

  it('keeps everything inside the company', async () => {
    as(outsider, other);
    const step = (await db.onboardingStep.findFirst({ where: { onboardingId: obId } }))!;
    expect((await STEP(req('PATCH', { action: 'waive', note: 'x' }), p(step.id))).status).toBe(404);
    expect((await INVITE(req('POST', { channels: ['sms'] }), p(obId))).status).toBe(404);
    expect((await START(req('POST', { applicationId: app, packageId: pkgId }))).status).toBe(404);
    // Another candidate's link can't touch Maria's steps.
    const oc = await db.candidate.create({ data: { organizationId: org, name: 'Someone Else' } });
    const { newToken, sha256 } = await import('@/lib/tokens');
    const tok = newToken();
    await db.workerLink.create({ data: { organizationId: org, candidateId: oc.id, tokenHash: sha256(tok), kind: 'onboarding', expiresAt: new Date(Date.now() + 864e5) } });
    expect((await WORKER(req('POST', { action: 'form', stepId: step.id, data: {} }), t(tok))).status).toBe(404);
  });

  it('cancelling voids unsigned documents', async () => {
    as(admin);
    const c = await db.candidate.create({ data: { organizationId: org, name: 'Late Cancel', email: 'lc@example.test' } });
    const a = await db.application.create({ data: { organizationId: org, candidateId: c.id, jobId: job, stage: 'PLACED' } });
    const { id } = await (await START(req('POST', { applicationId: a.id, packageId: pkgId, startDate: '2026-10-12' }))).json();
    expect((await OB(req('PATCH', { action: 'cancel' }), p(id))).status).toBe(200);
    expect((await db.signDocument.findFirst({ where: { organizationId: org, relatedId: c.id } }))!.status).toBe('VOID');
  });
});

describe('each company chooses', () => {
  it('can turn onboarding off (and back on) — only admins', async () => {
    const { PATCH } = await import('@/app/api/onboarding/settings/route');
    as(rec);
    expect((await PATCH(req('PATCH', { enabled: false, enforcement: 'warn' }))).status).toBe(403);
    as(admin);
    expect((await PATCH(req('PATCH', { enabled: false, enforcement: 'warn' }))).status).toBe(200);
    const off = await START(req('POST', { applicationId: app, packageId: pkgId }));
    expect([off.status, (await off.json()).error]).toEqual([403, 'Onboarding is turned off for your company. An admin can turn it on in Settings & data.']);
    expect((await (await PAGE(req('GET'), t())).json()).onboarding).toEqual([]);
    expect((await PATCH(req('PATCH', { enabled: true, enforcement: 'block' }))).status).toBe(200);
  });

  it('in block mode, unfinished onboarding stops scheduling and clock-in', async () => {
    as(rec);
    const c = await db.candidate.create({ data: { organizationId: org, name: 'Not Ready', phone: '5125550177' } });
    const a = await db.application.create({ data: { organizationId: org, candidateId: c.id, jobId: job, stage: 'PLACED' } });
    await START(req('POST', { applicationId: a.id, packageId: pkgId, startDate: '2026-10-05' }));
    const s = await ADD_SHIFT(req('POST', { applicationId: a.id, dates: ['2026-10-06'], start: '07:00', end: '19:00', breakMinutes: 30 }));
    expect([s.status, (await s.json()).error]).toEqual([409, 'Not Ready can’t be scheduled until onboarding is finished (5 required steps left).']);
    const { newToken, sha256 } = await import('@/lib/tokens');
    const tok = newToken();
    await db.workerLink.create({ data: { organizationId: org, candidateId: c.id, tokenHash: sha256(tok), kind: 'timeclock', expiresAt: new Date(Date.now() + 864e5) } });
    const { POST: PUNCH } = await import('@/app/api/public/clock/[token]/route');
    const pr = await PUNCH(req('POST', { action: 'in', applicationId: a.id }), t(tok));
    expect([pr.status, (await pr.json()).error]).toEqual([409, 'Finish your new-hire steps before clocking in. If you’re stuck, contact your recruiter.']);
    // Maria finished, so she can still be scheduled.
    expect((await ADD_SHIFT(req('POST', { applicationId: app, dates: ['2026-10-07'], start: '07:00', end: '19:00', breakMinutes: 30 }))).status).toBe(201);
  });

  it('sets onboarding per client', async () => {
    const { PATCH } = await import('@/app/api/onboarding/client-defaults/route');
    const client = (await db.client.findFirst({ where: { organizationId: org } }))!;
    as(rec);
    expect((await PATCH(req('PATCH', { clientId: client.id, mode: 'none' }))).status).toBe(403);
    as(admin);
    expect((await (await PATCH(req('PATCH', { clientId: client.id, mode: 'package' }))).json()).error).toBe('Choose the package this client always uses.');
    expect((await PATCH(req('PATCH', { clientId: client.id, mode: 'package', packageId: pkgId }))).status).toBe(200);
    expect(await db.client.findUnique({ where: { id: client.id } })).toMatchObject({ onboardingMode: 'package', onboardingPackageId: pkgId });
    expect((await PATCH(req('PATCH', { clientId: client.id, mode: 'none', packageId: pkgId }))).status).toBe(200);
    expect(await db.client.findUnique({ where: { id: client.id } })).toMatchObject({ onboardingMode: 'none', onboardingPackageId: null });
    as(outsider, other);
    expect((await PATCH(req('PATCH', { clientId: client.id, mode: 'ask' }))).status).toBe(404);
  });
});
