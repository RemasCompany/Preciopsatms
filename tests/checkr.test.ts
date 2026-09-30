import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { db } from '@/lib/db';
import { POST as ORDER, GET as LIST } from '@/app/api/background-checks/route';
import { GET as PACKAGES } from '@/app/api/background-checks/packages/route';
import { POST as HOOK } from '@/app/api/webhooks/checkr/route';

const RUN = `ck${Date.now()}`;
const KEY = 'checkr_test_key_123';
let org: string, rec: string, cand: string, noEmail: string;
const calls: { url: string; method: string; body: Record<string, unknown> | null; auth: string }[] = [];
const realFetch = globalThis.fetch;
const as = (u: string) => { session.current = { user: { id: u, orgId: org } }; };
const req = (method: string, body?: object) => new Request('http://x', { method, body: body ? JSON.stringify(body) : undefined });
const hook = (ev: object, key = KEY) => { const raw = JSON.stringify(ev); return HOOK(new Request('http://x', { method: 'POST', headers: { 'x-checkr-signature': createHmac('sha256', key).update(raw).digest('hex') }, body: raw })); };

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Screen Co', slug: `c-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  rec = (await db.user.create({ data: { email: `rec@${RUN}.test`, name: 'Rae', passwordHash: 'x' } })).id;
  await db.membership.create({ data: { userId: rec, organizationId: org, role: 'RECRUITER' } });
  cand = (await db.candidate.create({ data: { organizationId: org, name: 'Maria de la Cruz', email: 'maria@x.test', phone: '4075550100' } })).id;
  noEmail = (await db.candidate.create({ data: { organizationId: org, name: 'No Email' } })).id;
  globalThis.fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : null, auth: (init.headers as Record<string, string>).Authorization });
    if (url.endsWith('/packages')) return new Response(JSON.stringify({ data: [{ slug: 'tasker_standard', name: 'Standard' }] }));
    if (url.endsWith('/candidates')) return new Response(JSON.stringify({ id: `cc_${RUN}` }), { status: 201 });
    if (url.endsWith('/invitations')) return new Response(JSON.stringify({ id: `inv_${RUN}`, invitation_url: 'https://apply.checkr.com/x' }), { status: 201 });
    return new Response('{}', { status: 404 });
  }) as never;
});
afterEach(() => { delete process.env.CHECKR_API_KEY; });
afterAll(async () => {
  globalThis.fetch = realFetch;
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('Checkr background checks', () => {
  it('are off until the API key is set', async () => {
    as(rec);
    expect(await (await PACKAGES()).json()).toEqual({ enabled: false, packages: [] });
    expect((await (await ORDER(req('POST', { candidateId: cand, package: 'tasker_standard', state: 'FL' }))).json()).error).toBe('Background checks aren’t set up on this server yet (CHECKR_API_KEY).');
  });

  it('orders with only name, email and work location', async () => {
    process.env.CHECKR_API_KEY = KEY;
    as(rec);
    expect((await (await PACKAGES()).json()).packages).toEqual([{ slug: 'tasker_standard', name: 'Standard' }]);
    expect((await (await ORDER(req('POST', { candidateId: noEmail, package: 'tasker_standard', state: 'FL' }))).json()).error).toBe('Add No Email’s email first — Checkr sends them the consent form.');
    calls.length = 0;
    expect((await ORDER(req('POST', { candidateId: cand, package: 'tasker_standard', state: 'FL', city: 'Orlando' }))).status).toBe(201);
    expect(calls.map((c) => [c.method, c.url])).toEqual([['POST', 'https://api.checkr-staging.com/v1/candidates'], ['POST', 'https://api.checkr-staging.com/v1/invitations']]);
    expect(calls[0].body).toEqual({ first_name: 'Maria', last_name: 'de la Cruz', email: 'maria@x.test', custom_id: cand });
    expect(calls[1].body).toEqual({ candidate_id: `cc_${RUN}`, package: 'tasker_standard', work_locations: [{ country: 'US', state: 'FL', city: 'Orlando' }] });
    expect(calls[0].auth).toBe(`Basic ${Buffer.from(`${KEY}:`).toString('base64')}`);
    expect((await (await ORDER(req('POST', { candidateId: cand, package: 'tasker_standard', state: 'FL' }))).json()).error).toBe('Maria de la Cruz already has a background check in progress.');
    expect(await db.auditLog.count({ where: { organizationId: org, action: 'screening.order' } })).toBe(1);
  });

  it('follows status from signed webhooks; clear adds a verified credential', async () => {
    process.env.CHECKR_API_KEY = KEY;
    expect((await hook({ type: 'invitation.completed', data: { object: { id: `inv_${RUN}`, report_id: `rep_${RUN}` } } }, 'wrong-key')).status).toBe(401);
    expect((await hook({ type: 'invitation.completed', data: { object: { id: `inv_${RUN}`, report_id: `rep_${RUN}` } } })).status).toBe(200);
    expect(await db.backgroundCheck.findFirst({ where: { organizationId: org } })).toMatchObject({ status: 'pending', externalReportId: `rep_${RUN}` });
    expect(await (await hook({ type: 'report.completed', data: { object: { id: `rep_${RUN}`, status: 'complete', result: 'clear' } } })).json()).toEqual({ ok: true, applied: true });
    expect(await db.backgroundCheck.findFirst({ where: { organizationId: org } })).toMatchObject({ status: 'clear' });
    const cred = await db.credential.findFirst({ where: { organizationId: org, candidateId: cand, type: 'Background check' } });
    expect(cred).toMatchObject({ verifyMethod: 'Checkr report' });
    expect(cred!.verifiedAt).not.toBeNull();
    expect(await (await hook({ type: 'report.completed', data: { object: { id: 'rep_unknown', result: 'clear' } } })).json()).toEqual({ ok: true, applied: false });
    as(rec);
    expect((await (await LIST(new Request(`http://x?candidate=${cand}`))).json()).checks).toEqual([expect.objectContaining({ status: 'clear', package: 'tasker_standard' })]);
  });

  it('flags “consider” for review with the FCRA reminder', async () => {
    process.env.CHECKR_API_KEY = KEY;
    await db.backgroundCheck.updateMany({ where: { organizationId: org }, data: { status: 'pending' } });
    await hook({ type: 'report.completed', data: { object: { id: `rep_${RUN}`, result: 'consider' } } });
    expect(await db.backgroundCheck.findFirst({ where: { organizationId: org } })).toMatchObject({ status: 'consider' });
    expect(await db.activity.count({ where: { organizationId: org, text: { contains: 'FCRA adverse-action' } } })).toBe(1);
  });
});
