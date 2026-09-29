import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[], fail: false }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async (o: { to: string; subject: string; text: string }) => { if (mail.fail) throw new Error('down'); mail.sent.push(o); return { id: 'm1' }; }),
}));

import { db } from '@/lib/db';
import { GET as LIST, POST as CREATE } from '@/app/api/candidates/[id]/credentials/route';
import { PATCH, DELETE } from '@/app/api/credentials/[id]/route';
import { POST as VERIFY } from '@/app/api/credentials/[id]/verify/route';
import { PATCH as MOVE } from '@/app/api/applications/[id]/route';
import { GET as CRON } from '@/app/api/cron/credential-alerts/route';
import { alertDue, alertWindow, credentialStatus, placementIssues } from '@/lib/credentials';
import { lookupNpi, runCredentialAlerts, validNpi } from '@/lib/credentials-server';

const NOW = new Date('2026-09-29T12:00:00Z');
const plus = (days: number) => new Date(Date.UTC(2026, 8, 29 + days)).toISOString().slice(0, 10);

describe('credential status', () => {
  const base = { type: 'BLS', number: null, state: null, verifiedAt: '2026-01-01T00:00:00Z' };
  it('puts the worst problem first', () => {
    expect(credentialStatus({ ...base, expiresAt: plus(-1) }, NOW)).toMatchObject({ state: 'expired', level: 'warn', days: -1 });
    expect(credentialStatus({ ...base, expiresAt: plus(0) }, NOW)).toMatchObject({ state: 'expiring', text: 'Expires today' });
    expect(credentialStatus({ ...base, expiresAt: plus(30) }, NOW)).toMatchObject({ state: 'expiring', text: 'Expires in 30 days' });
    expect(credentialStatus({ ...base, expiresAt: plus(31) }, NOW).state).toBe('current');
    expect(credentialStatus({ ...base, expiresAt: plus(90), verifiedAt: null }, NOW).state).toBe('unverified');
  });
  it('asks for what a verifier needs', () => {
    expect(credentialStatus({ type: 'RN license', number: null, state: 'TX', expiresAt: null, verifiedAt: null }, NOW))
      .toMatchObject({ state: 'incomplete', text: 'Add number, expiration date' });
    expect(credentialStatus({ type: 'Hepatitis B', number: null, state: null, expiresAt: null, verifiedAt: 'x' }, NOW).state).toBe('current');
  });
  it('lists what should be fixed before a placement', () => {
    expect(placementIssues([
      { ...base, label: 'BLS', expiresAt: plus(-3) }, { ...base, label: 'ACLS', expiresAt: plus(10) },
      { ...base, label: 'TB test', expiresAt: plus(100), verifiedAt: null },
    ], NOW)).toEqual(['BLS: expired Sep 26, 2026', 'TB test: not verified']);
  });
});

describe('alert windows', () => {
  it('alerts at 60, 30 and 7 days and on expiry, once each', () => {
    expect([61, 60, 45, 30, 8, 7, 0, -1].map((d) => alertWindow(plus(d), NOW))).toEqual([null, 60, 60, 30, 30, 7, 7, 0]);
    expect(alertDue({ expiresAt: plus(45), alertedLevel: null }, NOW)).toBe(60);
    expect(alertDue({ expiresAt: plus(45), alertedLevel: 60 }, NOW)).toBeNull();
    expect(alertDue({ expiresAt: plus(20), alertedLevel: 60 }, NOW)).toBe(30);
    expect(alertDue({ expiresAt: plus(-2), alertedLevel: 7 }, NOW)).toBe(0);
    expect(alertDue({ expiresAt: plus(-2), alertedLevel: 0 }, NOW)).toBeNull();
    expect(alertDue({ expiresAt: null, alertedLevel: null }, NOW)).toBeNull();
  });
});

describe('NPI', () => {
  it('checks the check digit', () => {
    expect(validNpi('1234567893')).toBe(true);
    expect(validNpi('1245319599')).toBe(true);
    expect(validNpi('1234567890')).toBe(false);
    expect(validNpi('12345')).toBe(false);
  });
  const reply = (results: unknown[]) => (async () => new Response(JSON.stringify({ result_count: results.length, results }))) as unknown as typeof fetch;
  const person = { number: '1234567893', enumeration_type: 'NPI-1', basic: { first_name: 'MARIA', last_name: 'GARCÍA', status: 'A' }, taxonomies: [{ desc: 'Registered Nurse', primary: true, state: 'TX', license: '123456' }] };
  it('matches an active registration to the candidate', async () => {
    expect(await lookupNpi('1234567893', 'Maria Garcia', reply([person]))).toMatchObject({ found: true, active: true, nameMatches: true, individual: true, taxonomy: 'Registered Nurse', licenseState: 'TX' });
  });
  it('flags someone else’s number, deactivated numbers and unknown numbers', async () => {
    expect(await lookupNpi('1234567893', 'John Smith', reply([person]))).toMatchObject({ nameMatches: false });
    expect(await lookupNpi('1234567893', 'Maria Garcia', reply([{ ...person, basic: { ...person.basic, status: 'D' } }]))).toMatchObject({ active: false });
    expect(await lookupNpi('1234567893', 'Maria Garcia', reply([]))).toEqual({ found: false });
  });
  it('explains a registry outage', async () => {
    const down = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    await expect(lookupNpi('1234567893', 'Maria Garcia', down)).rejects.toThrow(/didn’t respond/);
  });
});

const RUN = `cr${Date.now()}`;
let org: string, other: string, starter: string, owner: string, recruiter: string, viewer: string, outsider: string, lite: string, cand: string, otherCand: string;
const as = (userId: string, orgId = org) => { session.current = { user: { id: userId, orgId } }; };
const req = (method: string, body?: object) => new Request('http://x', { method, body: body ? JSON.stringify(body) : undefined });
const p = (id: string) => ({ params: { id } });

beforeAll(async () => {
  const mk = (slug: string, plan: 'growth' | 'starter') => db.organization.create({ data: { name: slug, slug: `${slug}-${RUN}`, plan, subscriptionStatus: 'active' } }).then((o) => o.id);
  [org, other, starter] = await Promise.all([mk('Care Staffing', 'growth'), mk('Other', 'growth'), mk('Lite', 'starter')]);
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [owner, recruiter, viewer, outsider, lite] = await Promise.all([u('owner'), u('recruiter'), u('viewer'), u('outsider'), u('lite')]);
  await db.membership.createMany({ data: [
    { userId: owner, organizationId: org, role: 'OWNER' }, { userId: recruiter, organizationId: org, role: 'RECRUITER' }, { userId: viewer, organizationId: org, role: 'VIEWER' },
    { userId: outsider, organizationId: other, role: 'OWNER' }, { userId: lite, organizationId: starter, role: 'OWNER' },
  ] });
  cand = (await db.candidate.create({ data: { organizationId: org, name: 'Maria Garcia', title: 'RN' } })).id;
  otherCand = (await db.candidate.create({ data: { organizationId: other, name: 'Other Person' } })).id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('credentials API', () => {
  let id: string;
  it('adds and lists a candidate’s credentials', async () => {
    as(recruiter);
    const res = await CREATE(req('POST', { type: 'RN license', number: 'RN123', state: 'tx', issuedAt: '2025-01-01', expiresAt: '2027-01-31' }), p(cand));
    expect(res.status).toBe(201);
    const c = await res.json();
    id = c.id;
    expect(c).toMatchObject({ label: 'RN license · TX', state: 'TX', status: { state: 'unverified' } });
    const list = await (await LIST(req('GET'), p(cand))).json();
    expect(list.map((x: { id: string }) => x.id)).toEqual([id]);
  });

  it('validates input with friendly errors', async () => {
    as(recruiter);
    const e = async (body: object) => (await (await CREATE(req('POST', body), p(cand))).json()).error;
    expect(await e({ type: 'Unicorn license' })).toBe('Choose a credential type.');
    expect(await e({ type: 'RN license', state: 'Texas' })).toBe('Use the two-letter state code, like TX.');
    expect(await e({ type: 'BLS', issuedAt: '2026-05-01', expiresAt: '2026-01-01' })).toBe('The expiration date is before the issue date.');
    expect(await e({ type: 'NPI', number: '1234567890' })).toBe('That isn’t a valid 10-digit NPI.');
    expect(await e({ type: 'Other' })).toBe('Name the credential.');
  });

  it('records verification, and a renewal clears it', async () => {
    as(recruiter);
    const v = await VERIFY(req('POST', { method: 'Nursys QuickConfirm', note: 'Active, no discipline' }), p(id));
    expect((await v.json())).toMatchObject({ verifiedBy: 'recruiter', verifyMethod: 'Nursys QuickConfirm', status: { state: 'current' } });
    await db.credential.updateMany({ where: { id }, data: { alertedLevel: 30 } });
    // Notes don't touch verification; new dates do.
    expect((await (await PATCH(req('PATCH', { notes: 'Compact eligible' }), p(id))).json()).verifiedAt).not.toBeNull();
    const renewed = await (await PATCH(req('PATCH', { expiresAt: '2029-01-31' }), p(id))).json();
    expect(renewed).toMatchObject({ verifiedAt: null, verifyMethod: null, status: { state: 'unverified' } });
    expect((await db.credential.findUnique({ where: { id } }))!.alertedLevel).toBeNull();
  });

  it('won’t verify an expired or incomplete credential', async () => {
    as(recruiter);
    const exp = await (await CREATE(req('POST', { type: 'BLS', expiresAt: '2026-01-01' }), p(cand))).json();
    expect((await (await VERIFY(req('POST', { method: 'Other' }), p(exp.id))).json()).error).toMatch(/has expired/);
    const inc = await (await CREATE(req('POST', { type: 'RN license', state: 'CA' }), p(cand))).json();
    expect((await (await VERIFY(req('POST', { method: 'Other' }), p(inc.id))).json()).error).toBe('Add number, expiration date before verifying.');
    expect((await (await VERIFY(req('POST', { method: 'Guessed' }), p(inc.id))).json()).error).toBe('Choose how you verified it.');
  });

  it('keeps viewers read-only and needs a plan with credential tracking', async () => {
    as(viewer);
    expect((await LIST(req('GET'), p(cand))).status).toBe(200);
    expect((await CREATE(req('POST', { type: 'BLS' }), p(cand))).status).toBe(403);
    as(lite, starter);
    const c = await db.candidate.create({ data: { organizationId: starter, name: 'Lite Cand' } });
    expect((await CREATE(req('POST', { type: 'BLS' }), p(c.id))).status).toBe(402);
  });

  it('never reaches another company’s candidates or credentials', async () => {
    as(outsider, other);
    expect((await LIST(req('GET'), p(cand))).status).toBe(404);
    expect((await CREATE(req('POST', { type: 'BLS' }), p(cand))).status).toBe(404);
    expect((await PATCH(req('PATCH', { number: 'X' }), p(id))).status).toBe(404);
    expect((await VERIFY(req('POST', { method: 'Other' }), p(id))).status).toBe(404);
    expect((await DELETE(req('DELETE'), p(id))).status).toBe(404);
    expect((await db.credential.findUnique({ where: { id } }))!.number).toBe('RN123');
  });
});

describe('placement warning', () => {
  it('flags credential problems when someone is placed', async () => {
    as(recruiter);
    const job = await db.job.create({ data: { organizationId: org, title: 'Travel RN', openings: 2 } });
    const app = await db.application.create({ data: { organizationId: org, jobId: job.id, candidateId: cand, stage: 'OFFER' } });
    const body = await (await MOVE(req('PATCH', { stage: 'PLACED' }), p(app.id))).json();
    expect(body.ok).toBe(true);
    expect(body.warning).toMatch(/Check Maria Garcia’s credentials before they start — .*BLS: expired/);
  });
});

describe('expiration alerts', () => {
  it('sends each recruiter one digest per crossing, then stays quiet', async () => {
    await db.credential.deleteMany({ where: { organizationId: org } });
    const inactive = await db.candidate.create({ data: { organizationId: org, name: 'Gone Person', status: 'Inactive' } });
    const add = (candidateId: string, type: string, days: number, orgId = org) => db.credential.create({ data: { organizationId: orgId, candidateId, type, expiresAt: new Date(`${plus(days)}T00:00:00Z`) } });
    await Promise.all([add(cand, 'BLS', 20), add(cand, 'ACLS', 50), add(cand, 'TB test', -3), add(cand, 'PALS', 90), add(inactive.id, 'BLS', 5), add(otherCand, 'BLS', 5, other)]);
    mail.sent = [];
    const r = await runCredentialAlerts(NOW, 'https://app.test');
    const mine = mail.sent.filter((m) => m.to.endsWith(`@${RUN}.test`));
    expect(mine.map((m) => m.to).sort()).toEqual([`outsider@${RUN}.test`, `owner@${RUN}.test`, `recruiter@${RUN}.test`]);
    const ours = mine.find((m) => m.to.startsWith('owner'))!;
    expect(ours.subject).toBe('1 credential has expired, 2 expiring soon');
    expect(ours.text).toContain('Maria Garcia — TB test: expired');
    expect(ours.text).toContain('Maria Garcia — BLS: expires Oct 19, 2026');
    expect(ours.text).toContain('https://app.test/app/credentials');
    expect(ours.text).not.toMatch(/PALS|Gone Person|Other Person/);
    expect(r.emails).toBeGreaterThanOrEqual(3);
    expect(await db.message.count({ where: { organizationId: org, relatedType: 'credential_alert', status: 'sent' } })).toBe(2);
    const levels = await db.credential.findMany({ where: { organizationId: org, candidateId: cand }, orderBy: { type: 'asc' } });
    expect(levels.map((c) => [c.type, c.alertedLevel])).toEqual([['ACLS', 60], ['BLS', 30], ['PALS', null], ['TB test', 0]]);

    mail.sent = [];
    await runCredentialAlerts(NOW, 'https://app.test');
    expect(mail.sent.filter((m) => m.to.endsWith(`@${RUN}.test`))).toHaveLength(0);
    // Two weeks later BLS reaches the 7-day window.
    await runCredentialAlerts(new Date('2026-10-13T12:00:00Z'), 'https://app.test');
    const later = mail.sent.find((m) => m.to === `owner@${RUN}.test`)!;
    expect(later.subject).toBe('1 credential expiring soon');
  });

  it('retries tomorrow when email is down', async () => {
    await db.credential.deleteMany({ where: { organizationId: org } });
    const c = await db.credential.create({ data: { organizationId: org, candidateId: cand, type: 'NRP', expiresAt: new Date(`${plus(25)}T00:00:00Z`) } });
    mail.fail = true;
    await runCredentialAlerts(NOW, 'https://app.test');
    mail.fail = false;
    expect((await db.credential.findUnique({ where: { id: c.id } }))!.alertedLevel).toBeNull();
    expect(await db.message.count({ where: { organizationId: org, relatedType: 'credential_alert', status: 'failed' } })).toBe(2);
  });

  it('only runs for the scheduler', async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'cron-secret-123';
    expect((await CRON(new Request('http://x'))).status).toBe(401);
    expect((await CRON(new Request('http://x', { headers: { authorization: 'Bearer nope' } }))).status).toBe(401);
    expect((await CRON(new Request('http://x', { headers: { authorization: 'Bearer cron-secret-123' } }))).status).toBe(200);
    process.env.CRON_SECRET = prev;
  });
});
