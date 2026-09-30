import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const create = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/sdk', async (orig) => {
  const real = (await orig<{ default: typeof import('@anthropic-ai/sdk').default }>()).default;
  class Fake { beta = { messages: { create } }; static AuthenticationError = real.AuthenticationError; static PermissionDeniedError = real.PermissionDeniedError; static RateLimitError = real.RateLimitError; static APIError = real.APIError; }
  return { default: Fake };
});
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import Anthropic from '@anthropic-ai/sdk';
import { db } from '@/lib/db';
import { POST } from '@/app/api/assistant/route';

const RUN = `as${Date.now()}`;
let org: string, admin: string, rec: string;
const as = (u: string) => { session.current = { user: { id: u, orgId: org } }; };
const post = (question: string, history: unknown[] = []) => POST(new Request('http://x/api/assistant', { method: 'POST', body: JSON.stringify({ question, history }) }));
const toolUse = (name: string, input: object, id = `tu_${name}`) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });
const text = (t: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
type Req = { messages: { role: string; content: unknown }[]; tools: { name: string; input_schema: { properties: Record<string, { enum?: string[] }> } }[]; model: string };
const sent = () => create.mock.calls.map((c) => c[0] as Req);
const toolResults = () => JSON.stringify(sent().flatMap((r) => r.messages.filter((m) => m.role === 'user' && Array.isArray(m.content))));
const credits = async () => (await db.organization.findUniqueOrThrow({ where: { id: org } })).aiCreditsUsed;

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  org = (await db.organization.create({ data: { name: 'Asst Co', slug: `a-${RUN}`, plan: 'growth', subscriptionStatus: 'active', timezone: 'America/Chicago' } })).id;
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [admin, rec] = await Promise.all([u('admin'), u('rec')]);
  await db.membership.createMany({ data: [{ userId: admin, organizationId: org, role: 'ADMIN' }, { userId: rec, organizationId: org, role: 'RECRUITER' }] });
  const client = await db.client.create({ data: { organizationId: org, name: 'Harbor Freight Co' } });
  await db.contact.create({ data: { organizationId: org, clientId: client.id, name: 'Priya Contactperson', email: 'priya@harbor.test', phone: '+15550001111' } });
  const job = await db.job.create({ data: { organizationId: org, clientId: client.id, title: 'Forklift operator', type: 'TEMP', payRate: 20, billRate: 30, openings: 2 } });
  const cand = await db.candidate.create({ data: { organizationId: org, name: 'Zelda Uniquename', email: 'zelda@private.test', phone: '+15559876543' } });
  await db.eeoSelfId.create({ data: { organizationId: org, candidateId: cand.id, gender: 'female', race: 'Asian' } as never });
  await db.application.create({ data: { organizationId: org, candidateId: cand.id, jobId: job.id, stage: 'PLACED', maxStage: 'PLACED', stageChangedAt: new Date() } });
  // Another company's job must never show up.
  const other = await db.organization.create({ data: { name: 'Other', slug: `o-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } });
  await db.job.create({ data: { organizationId: other.id, title: 'Secret other-tenant job', type: 'TEMP' } });
});
afterAll(async () => { await db.organization.deleteMany({ where: { slug: { in: [`a-${RUN}`, `o-${RUN}`] } } }); });

describe('assistant', () => {
  it('answers from tools without sending names, contact details or EEO data', async () => {
    as(admin); create.mockReset();
    const today = new Date().toISOString().slice(0, 10), start = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10);
    create.mockResolvedValueOnce(toolUse('get_overview', {}))
      .mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'list_open_jobs', input: {} }, { type: 'tool_use', id: 't3', name: 'run_report', input: { report: 'placements', from: start, to: today } }] })
      .mockResolvedValueOnce(text('You have 1 open job and placed 1 person this month.'));
    const r = await post('What needs my attention? Email me at boss@asst.test or call 555-222-3333');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ answer: 'You have 1 open job and placed 1 person this month.' });
    const reqs = sent();
    expect(reqs).toHaveLength(3);
    expect(reqs[0].model).toBe('claude-opus-5-5');
    const all = JSON.stringify(reqs);
    expect(all).not.toContain('boss@asst.test');
    expect(all).not.toContain('555-222-3333');
    for (const secret of ['Zelda', 'Uniquename', 'zelda@private.test', '9876543', 'Priya', 'priya@harbor.test', 'female', 'Asian', 'Secret other-tenant job']) expect(all).not.toContain(secret);
    const results = toolResults();
    expect(results).toContain('Forklift operator');
    expect(results).toContain('Harbor Freight Co');
    expect(results).toContain('Worker 1');
    expect(results).toContain('payRate'); // admins see rates
    // Both tool results from one turn go back in a single user message.
    expect((reqs[2].messages.at(-1)!.content as unknown[]).length).toBe(2);
    expect(await credits()).toBe(1);
  });

  it('hides pay and margin tools from recruiters', async () => {
    as(rec); create.mockReset();
    create.mockResolvedValueOnce(toolUse('list_open_jobs', {})).mockResolvedValueOnce(text('One job.'));
    expect((await post('Which jobs are open?')).status).toBe(200);
    const report = sent()[0].tools.find((t) => t.name === 'run_report')!;
    expect(report.input_schema.properties.report.enum).not.toContain('margin');
    expect(report.input_schema.properties.report.enum).toContain('funnel');
    expect(toolResults()).not.toContain('payRate');
    expect(toolResults()).not.toContain('receivables');
  });

  it('reports a tool error back to the model instead of failing', async () => {
    as(rec); create.mockReset();
    create.mockResolvedValueOnce(toolUse('run_report', { report: 'margin', from: '2026-01-01', to: '2026-01-31' })).mockResolvedValueOnce(text('Margin is only for admins.'));
    const r = await post('What was our margin?');
    expect(r.status).toBe(200);
    expect(toolResults()).toContain('"is_error":true');
  });

  it('refunds the credit when the API fails and returns a friendly error', async () => {
    as(admin); create.mockReset();
    const before = await credits();
    create.mockRejectedValueOnce(new Anthropic.RateLimitError(429, { error: {} }, 'slow down', new Headers()));
    const r = await post('Anything overdue?');
    expect(r.status).toBe(429);
    expect((await r.json()).error).toMatch(/busy/);
    expect(await credits()).toBe(before);
  });

  it('handles refusals and validates input', async () => {
    as(admin); create.mockReset();
    create.mockResolvedValueOnce({ stop_reason: 'refusal', content: [] });
    expect((await (await post('something odd')).json()).answer).toMatch(/can’t help/);
    expect((await post(' ')).status).toBe(400);
  });

  it('is only on plans with AI', async () => {
    await db.organization.update({ where: { id: org }, data: { plan: 'starter' } });
    as(admin);
    try { expect((await post('hello there')).status).toBe(402); }
    finally { await db.organization.update({ where: { id: org }, data: { plan: 'growth' } }); }
  });
});
