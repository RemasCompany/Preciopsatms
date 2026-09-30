import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const out = vi.hoisted(() => ({ texts: [] as { to: string; body: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/sms', async (orig) => ({ ...(await orig<typeof import('@/lib/sms')>()), validateTwilioSignature: () => true, sendSms: vi.fn(async (to: string, body: string) => { out.texts.push({ to, body }); return { id: 'SM1' }; }) }));

import { db } from '@/lib/db';
import { POST as INBOUND } from '@/app/api/sms/inbound/route';
import { GET as THREADS } from '@/app/api/inbox/route';
import { POST as THREAD } from '@/app/api/inbox/thread/route';
import { POST as REPLY } from '@/app/api/inbox/reply/route';
import { POST as SEND } from '@/app/api/messages/send/route';

const RUN = `sx${Date.now()}`;
const n = (Date.now() % 9000) + 1000; // unique phone suffix per run
const PHONE = `407555${n}`, CONTACT_PHONE = `321555${n}`, SHARED = `689555${n}`;
let a: string, b: string, rec: string, cand: string, contact: string, lead: string, candB: string;
const as = (u: string, o = a) => { session.current = { user: { id: u, orgId: o } }; };
const inbound = (from: string, body: string, to = '+15550000000') => {
  const f = new FormData(); f.set('From', `+1${from}`); f.set('To', to); f.set('Body', body); f.set('MessageSid', `SM${Math.random()}`);
  return INBOUND(new Request('http://x', { method: 'POST', body: f }));
};
const req = (method: string, body?: object) => new Request('http://x', { method, body: body ? JSON.stringify(body) : undefined });

beforeAll(async () => {
  a = (await db.organization.create({ data: { name: 'Alpha', slug: `a-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  b = (await db.organization.create({ data: { name: 'Beta', slug: `b-${RUN}`, plan: 'growth', subscriptionStatus: 'active', smsNumber: `+1555${String(n).padStart(4, '0')}999` } })).id;
  rec = (await db.user.create({ data: { email: `rec@${RUN}.test`, name: 'Rae', passwordHash: 'x' } })).id;
  await db.membership.create({ data: { userId: rec, organizationId: a, role: 'RECRUITER' } });
  cand = (await db.candidate.create({ data: { organizationId: a, name: 'Ana Diaz', phone: PHONE } })).id;
  const client = await db.client.create({ data: { organizationId: a, name: 'Harbor' } });
  contact = (await db.contact.create({ data: { organizationId: a, clientId: client.id, name: 'Rita', phone: CONTACT_PHONE } })).id;
  lead = (await db.lead.create({ data: { organizationId: a, company: 'Leadco', contact: 'Lee', phone: CONTACT_PHONE } })).id;
  // The same person is a candidate at both companies.
  await db.candidate.create({ data: { organizationId: a, name: 'Sam Shared', phone: SHARED } });
  candB = (await db.candidate.create({ data: { organizationId: b, name: 'Sam Shared', phone: SHARED } })).id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('two-way texting', () => {
  it('files a reply under the only company that knows the number, matched to the candidate', async () => {
    await inbound(PHONE, 'Running 10 min late');
    const m = await db.message.findFirst({ where: { organizationId: a, direction: 'in' } });
    expect(m).toMatchObject({ relatedType: 'candidate', relatedId: cand, body: 'Running 10 min late', status: 'received', readAt: null });
    as(rec);
    const { threads } = await (await THREADS()).json();
    expect(threads[0]).toMatchObject({ name: 'Ana Diaz', unread: 1, lastIn: true });
  });

  it('routes a shared number by the company’s own number, else by who texted last', async () => {
    await inbound(SHARED, 'Hi Beta', `+1555${String(n).padStart(4, '0')}999`);
    expect(await db.message.count({ where: { organizationId: b, direction: 'in', relatedId: candB } })).toBe(1);
    await inbound(SHARED, 'Who is this?'); // unknown: both companies know Sam, nobody texted them
    expect(await db.message.count({ where: { fromAddress: `+1${SHARED}`, body: 'Who is this?' } })).toBe(0);
    await db.message.create({ data: { organizationId: a, channel: 'sms', direction: 'out', toAddress: SHARED, body: 'Shift tomorrow?', status: 'sent' } });
    await inbound(SHARED, 'Yes I can');
    expect(await db.message.count({ where: { organizationId: a, direction: 'in', body: 'Yes I can' } })).toBe(1);
  });

  it('picks whoever was texted last when two people share a phone', async () => {
    const sis = await db.candidate.create({ data: { organizationId: a, name: 'Ava Diaz', phone: PHONE } });
    await db.message.create({ data: { organizationId: a, channel: 'sms', direction: 'out', toAddress: PHONE, body: 'Can you work Friday?', status: 'sent', relatedType: 'candidate', relatedId: sis.id } });
    await inbound(PHONE, 'Yes!');
    expect(await db.message.findFirst({ where: { organizationId: a, direction: 'in', body: 'Yes!' } })).toMatchObject({ relatedId: sis.id });
  });

  it('opens a thread (marking it read) and replies', async () => {
    const { messages } = await (await THREAD(req('POST', { type: 'candidate', id: cand, phone: PHONE }))).json();
    expect(messages.map((m: { body: string }) => m.body)).toEqual(['Running 10 min late']);
    expect((await db.message.findFirst({ where: { organizationId: a, relatedId: cand, direction: 'in' } }))!.readAt).not.toBeNull();
    out.texts = [];
    expect((await REPLY(req('POST', { type: 'candidate', id: cand, phone: PHONE, body: 'Thanks for the heads up!' }))).status).toBe(200);
    expect(out.texts).toEqual([{ to: PHONE, body: 'Thanks for the heads up!' }]);
    expect(await db.message.count({ where: { organizationId: a, relatedId: cand, direction: 'out', status: 'sent' } })).toBe(1);
  });

  it('STOP opts out candidates, contacts and leads, and sending then refuses', async () => {
    await inbound(CONTACT_PHONE, 'STOP');
    expect((await db.contact.findUnique({ where: { id: contact } }))!.smsOptOut).toBe(true);
    expect((await db.lead.findUnique({ where: { id: lead } }))!.smsOptOut).toBe(true);
    expect((await (await REPLY(req('POST', { type: 'contact', id: contact, phone: CONTACT_PHONE, body: 'hello' }))).json()).error).toBe('Rita replied STOP, so they can’t be texted until they reply START.');
    out.texts = [];
    expect(await (await SEND(req('POST', { channel: 'sms', recipientType: 'contact', recipientIds: [contact], body: 'Promo' }))).json()).toMatchObject({ sent: 0, skipped: 1 });
    expect(out.texts).toHaveLength(0);
    await inbound(CONTACT_PHONE, 'START');
    expect((await db.contact.findUnique({ where: { id: contact } }))!.smsOptOut).toBe(false);
  });
});
