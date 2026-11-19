import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const create = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/sdk', async (orig) => {
  const real = (await orig<{ default: typeof import('@anthropic-ai/sdk').default }>()).default;
  class Fake { beta = { messages: { create } }; static AuthenticationError = real.AuthenticationError; static PermissionDeniedError = real.PermissionDeniedError; static RateLimitError = real.RateLimitError; static APIError = real.APIError; static BadRequestError = real.BadRequestError; }
  return { default: Fake };
});
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import Anthropic from '@anthropic-ai/sdk';
import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { POST } from '@/app/api/assistant/route';
import { reference, STATE_PFML, FEDERAL, OFFICIAL_DOMAINS } from '@/lib/hr-law';

const RUN = `hr${Date.now()}`;
let org: string, admin: string;
const post = (question: string) => POST(new Request('http://x/api/assistant', { method: 'POST', body: JSON.stringify({ question, mode: 'hr' }) }));
const toolUse = (name: string, input: object, id = `tu_${name}`) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });
const text = (t: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
type Req = { system: string; messages: { role: string; content: unknown }[]; tools: { name: string; type?: string; allowed_domains?: string[] }[] };
const sent = () => create.mock.calls.map((c) => c[0] as Req);

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  org = (await db.organization.create({ data: { name: 'Leave Co', slug: `l-${RUN}`, plan: 'growth', subscriptionStatus: 'active', kind: 'EMPLOYER', city: 'Boca Raton, FL' } })).id;
  admin = (await db.user.create({ data: { email: `admin@${RUN}.test`, name: 'Hana Admin', passwordHash: 'x' } })).id;
  await db.membership.create({ data: { userId: admin, organizationId: org, role: 'ADMIN' } });
  const t = tenantDb(org);
  const branch = await t.branch.create({ data: { name: 'Minneapolis office', city: 'Minneapolis, MN' } as never });
  for (let i = 0; i < 3; i++) {
    const c = await t.candidate.create({ data: { name: i === 0 ? 'Bettina Rarename' : `Staff ${i}` } as never });
    await t.employee.create({ data: { candidateId: c.id, title: 'Clerk', startDate: new Date('2025-01-01'), payRate: 20, branchId: i === 0 ? branch.id : null } as never });
  }
  await t.leavePolicy.create({ data: { name: 'Sick leave', paid: true, method: 'HOURS_WORKED', rate: 0.0333 } as never });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: `l-${RUN}` } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
});

describe('HR compliance reference', () => {
  it('covers family leave with official sources and current state programs', () => {
    expect(FEDERAL.fmla.summary.join(' ')).toMatch(/50 or more employees[\s\S]*1,250 hours[\s\S]*12 workweeks/);
    for (const e of [...Object.values(FEDERAL), ...Object.values(STATE_PFML)]) for (const s of e.sources) expect(s).toMatch(/^https:\/\//);
    expect(STATE_PFML.MN.status).toContain('2026');
    expect(STATE_PFML.MD.status).toMatch(/2028/);
    expect(reference('fmla', 'mn').entries.map((e) => e.title)).toEqual([FEDERAL.fmla.title, STATE_PFML.MN.title]);
    expect(reference('fmla', 'FL').entries[1].title).toMatch(/no state paid family/);
    expect(OFFICIAL_DOMAINS).toEqual(expect.arrayContaining(['dol.gov', 'eeoc.gov', 'mn.gov']));
  });
});

describe('Smarty in HR compliance mode', () => {
  it('uses company facts and the reference, searches only official sites, and never sends names', async () => {
    session.current = { user: { id: admin, orgId: org } }; create.mockReset();
    create.mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'company_facts', input: {} }, { type: 'tool_use', id: 't2', name: 'hr_reference', input: { topic: 'fmla', state: 'MN' } }] })
      .mockResolvedValueOnce(text('With 3 employees, federal FMLA does not apply yet, but Minnesota Paid Leave does. Person A can apply to the state program.\n\nSources: https://paidleave.mn.gov/'));
    const r = await post('Bettina Rarename wants 8 weeks off to care for her mother. Does FMLA apply?');
    expect(r.status).toBe(200);
    const { answer } = await r.json();
    expect(answer).toContain('Bettina Rarename can apply'); // names restored for the reader
    const reqs = sent();
    const all = JSON.stringify(reqs);
    expect(all).not.toContain('Bettina'); // …but never sent
    expect(reqs[0].system).toContain('HR compliance expert');
    const search = reqs[0].tools.find((t) => t.name === 'web_search')!;
    expect(search.type).toBe('web_search_20260209');
    expect(search.allowed_domains).toContain('dol.gov');
    const facts = JSON.parse((reqs[1].messages.at(-1)!.content as { content: string }[])[0].content);
    expect(facts).toMatchObject({ activeEmployees: 3, statesWherePeopleWork: ['FL', 'MN'] });
    expect(facts.federalLawsLikelyToApply.find((l: { law: string }) => l.law === 'FMLA').likely).toBe(false);
    expect(facts.leavePoliciesInPreciops[0]).toMatchObject({ name: 'Sick leave', paid: true });
    const ref = JSON.parse((reqs[1].messages.at(-1)!.content as { content: string }[])[1].content);
    expect(ref.entries.map((e: { title: string }) => e.title)).toContain('Minnesota Paid Leave');
  });

  it('answers without search when the AI account doesn’t have it switched on', async () => {
    create.mockReset();
    create.mockRejectedValueOnce(new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'web_search is not enabled for this organization' } }, 'web_search is not enabled for this organization', new Headers()))
      .mockResolvedValueOnce(text('Answer from the reference.'));
    const r = await post('What notices do we owe for FMLA?');
    expect((await r.json()).answer).toBe('Answer from the reference.');
    const reqs = sent();
    expect(reqs).toHaveLength(2);
    expect(reqs[1].tools.some((t) => t.name === 'web_search')).toBe(false);
    expect(reqs[1].system).toContain('point the person to the program’s official site');
  });

  it('lets a paused search finish', async () => {
    create.mockReset();
    create.mockResolvedValueOnce({ stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'x' } }] })
      .mockResolvedValueOnce(text('Done.'));
    expect((await (await post('Minnesota paid leave weekly maximum this year?')).json()).answer).toBe('Done.');
    expect(sent()[1].messages.at(-1)!.role).toBe('assistant');
  });
});
