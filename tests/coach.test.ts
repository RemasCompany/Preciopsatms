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

import { db } from '@/lib/db';
import { POST } from '@/app/api/assistant/route';
import { pseudonymize } from '@/lib/pseudonymize';

const RUN = `co${Date.now()}`;
let org: string, rec: string, viewer: string;
const as = (u: string) => { session.current = { user: { id: u, orgId: org } }; };
const post = (question: string, history: unknown[] = [], mode = 'coach') => POST(new Request('http://x/api/assistant', { method: 'POST', body: JSON.stringify({ question, history, mode }) }));
type Req = { system: string; messages: { role: string; content: string }[]; tools?: unknown; output_config: { effort: string } };
const last = () => create.mock.calls.at(-1)![0] as Req;

describe('pseudonymize', () => {
  it('replaces full names, unique first names and teammates, and puts them back', () => {
    const p = pseudonymize(['Maria Lopez and james carter argued. Maria says James started it; Ana Maria Lopez saw it. Will said nothing.'], ['Maria Lopez', 'James Carter', 'Ana Maria Lopez', 'Will Smith', 'Will Jones']);
    expect(p.texts[0]).toBe('Person A and Person B argued. Person A says Person B started it; Person C saw it. Will said nothing.'); // two Wills: left alone
    expect(p.restore('Talk to Person A first, then Person B. Person C is a witness.')).toBe('Talk to Maria Lopez first, then James Carter. Person C is a witness.'.replace('Person C', 'Ana Maria Lopez'));
    expect(p.count).toBe(3);
  });
  it('keeps aliases stable across turns and handles many people', () => {
    const names = Array.from({ length: 30 }, (_, i) => `First${String.fromCharCode(97 + (i % 26))}${i} Last${i}`);
    const p = pseudonymize(names.map((n) => `${n} said hi`), names);
    expect(p.texts[0]).toBe('Person A said hi');
    expect(p.texts[27]).toBe('Person AB said hi');
    expect(p.restore('Person AB and Person A')).toBe(`${names[27]} and ${names[0]}`);
  });
});

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  org = (await db.organization.create({ data: { name: 'Coach Co', slug: `c-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  rec = (await db.user.create({ data: { email: `rec@${RUN}.test`, name: 'Rae Recruiter', passwordHash: 'x' } })).id;
  viewer = (await db.user.create({ data: { email: `v@${RUN}.test`, name: 'Vic Viewer', passwordHash: 'x' } })).id;
  await db.membership.createMany({ data: [{ userId: rec, organizationId: org, role: 'RECRUITER' }, { userId: viewer, organizationId: org, role: 'VIEWER' }] });
  const job = await db.job.create({ data: { organizationId: org, title: 'Packer' } });
  for (const name of ['Maria Lopez', 'James Carter']) {
    const c = await db.candidate.create({ data: { organizationId: org, name, email: `${name.split(' ')[0].toLowerCase()}@x.test` } });
    await db.application.create({ data: { organizationId: org, candidateId: c.id, jobId: job.id, stage: 'PLACED' } });
  }
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
});

describe('manager coaching', () => {
  it('sends the situation without names or contact details, and answers with the real names', async () => {
    as(rec);
    create.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Meet Person A and Person B separately first. Rae Recruiter should take notes.' }] });
    const r = await post('Maria Lopez and James Carter keep arguing about handoffs. Maria emailed me at maria@x.test. Rae Recruiter saw the last one.');
    expect(r.status).toBe(200);
    expect((await r.json()).answer).toBe('Meet Maria Lopez and James Carter separately first. Rae Recruiter should take notes.');
    const sent = JSON.stringify(last().messages);
    for (const leak of ['Maria', 'James', 'Carter', 'Rae', 'maria@x.test']) expect(sent).not.toContain(leak);
    expect(sent).toContain('Person A and Person B keep arguing');
    expect(sent).toContain('[email]');
    expect(last().tools).toBeUndefined(); // no business data in coaching
    expect(last().output_config.effort).toBe('medium');
    expect(last().system).toContain('involve HR');
    expect(last().system).toContain('harassment or discrimination');
    expect(last().system).toContain('not legal advice');
    expect(last().system).toContain('the agency is the employer of record');
  });

  it('carries the conversation with the same masking', async () => {
    as(rec);
    create.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Then document it and follow up with Person A on Friday.' }] });
    const r = await (await post('It happened again today.', [{ q: 'Maria Lopez keeps arriving late.', a: 'Talk to Maria Lopez privately.' }])).json();
    expect(r.answer).toBe('Then document it and follow up with Maria Lopez on Friday.');
    expect(last().messages[0].content).toContain('Manager: Person A keeps arriving late.\nYou: Talk to Person A privately.');
    expect(last().messages[0].content).not.toContain('Maria');
  });

  it('uses a credit per question, refunds on failure, and isn’t for viewers', async () => {
    as(rec);
    const before = (await db.organization.findUniqueOrThrow({ where: { id: org } })).aiCreditsUsed;
    create.mockRejectedValueOnce(new Error('boom'));
    expect((await post('How do I coach someone?')).status).toBe(500);
    expect((await db.organization.findUniqueOrThrow({ where: { id: org } })).aiCreditsUsed).toBe(before);
    as(viewer);
    expect((await post('How do I coach someone?')).status).toBe(403);
  });
});
