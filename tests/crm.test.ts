import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const ai = vi.hoisted(() => ({ prompts: [] as string[], reply: { score: 82, why: 'Good fit', nextStep: 'Call', subject: 'Hello', body: 'Hi [First name], ...' } as unknown }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/ai', () => ({ aiJson: vi.fn(async (_org: unknown, prompt: string) => { ai.prompts.push(prompt); return ai.reply; }) }));

import { db } from '@/lib/db';
import { PATCH } from '@/app/api/records/[kind]/[id]/route';
import { POST as SCORE } from '@/app/api/ai/lead-score/route';
import { dealKpis } from '@/lib/deals';

const RUN = `c${Date.now()}`;
let org: string;
const patch = (kind: string, id: string, body: object) => PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), { params: { kind, id } });

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Acme Staffing', slug: `c-${RUN}`, plan: 'growth', subscriptionStatus: 'active', city: 'Austin, TX', ownerName: 'Pat Owner' } })).id;
  const u = await db.user.create({ data: { email: `u@${RUN}.test`, passwordHash: 'x' } });
  await db.membership.create({ data: { userId: u.id, organizationId: org, role: 'RECRUITER' } });
  session.current = { user: { id: u.id, orgId: org } };
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('deal KPIs', () => {
  it('computes open, weighted, won and win rate', () => {
    const k = dealKpis([
      { stage: 'Prospect', value: 10000 }, { stage: 'Proposal', value: 40000 }, { stage: 'Negotiation', value: null },
      { stage: 'Won', value: 25000 }, { stage: 'Won', value: 5000 }, { stage: 'Lost', value: 99000 },
    ]);
    expect(k).toEqual({ open: 50000, weighted: 10000 * 0.1 + 40000 * 0.5, won: 30000, winRate: 2 / 3 });
  });
  it('has no win rate before any deal closes', () => {
    expect(dealKpis([{ stage: 'Qualified', value: 1 }]).winRate).toBeNull();
  });
});

describe('record side effects', () => {
  it('winning a deal marks its client active and logs the move', async () => {
    const client = await db.client.create({ data: { organizationId: org, name: 'Prospect Co', status: 'Prospect' } });
    const deal = await db.deal.create({ data: { organizationId: org, clientId: client.id, title: 'Big one', stage: 'Negotiation' } });
    expect((await patch('deals', deal.id, { stage: 'Won' })).status).toBe(200);
    expect((await db.client.findUniqueOrThrow({ where: { id: client.id } })).status).toBe('Active');
    expect(await db.activity.count({ where: { organizationId: org, text: 'Deal “Big one” moved to Won' } })).toBe(1);
  });

  it('completing a task logs it once', async () => {
    const t = await db.task.create({ data: { organizationId: org, title: 'Call Rita' } });
    await patch('tasks', t.id, { done: true });
    await patch('tasks', t.id, { done: true });
    expect(await db.activity.count({ where: { organizationId: org, text: 'Completed: Call Rita' } })).toBe(1);
  });
});

describe('AI lead scoring', () => {
  it('never sends the contact’s name, email or phone to the model', async () => {
    const lead = await db.lead.create({ data: { organizationId: org, company: 'Northwind Freight', contact: 'Omar Zuberi', role: 'VP Operations', email: 'omar@northwind.test', phone: '555-0199', industry: 'Logistics' } });
    const res = await SCORE(new Request('http://x', { method: 'POST', body: JSON.stringify({ leadId: lead.id }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ score: 82, subject: 'Hello' });
    const prompt = ai.prompts.at(-1)!;
    expect(prompt).toContain('Northwind Freight');
    expect(prompt).toContain('VP Operations');
    for (const secret of ['Omar', 'Zuberi', 'omar@northwind.test', '555-0199']) expect(prompt).not.toContain(secret);
  });

  it('clamps the score and rejects unreadable replies', async () => {
    const lead = await db.lead.create({ data: { organizationId: org, company: 'Z Corp' } });
    const call = () => SCORE(new Request('http://x', { method: 'POST', body: JSON.stringify({ leadId: lead.id }) }));
    ai.reply = { score: 140, why: '', nextStep: '', subject: 's', body: 'b' };
    expect((await (await call()).json()).score).toBe(100);
    ai.reply = { score: 'high' };
    expect((await call()).status).toBe(502);
  });

  it('cannot score another org’s lead', async () => {
    const other = await db.organization.create({ data: { name: 'O', slug: `o-${RUN}` } });
    const lead = await db.lead.create({ data: { organizationId: other.id, company: 'Theirs' } });
    const res = await SCORE(new Request('http://x', { method: 'POST', body: JSON.stringify({ leadId: lead.id }) }));
    expect(res.status).toBe(404);
  });
});
