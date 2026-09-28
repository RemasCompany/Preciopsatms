import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const mail = vi.hoisted(() => ({ sent: [] as Record<string, unknown>[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: Record<string, unknown>) => {
  if (String(o.to).endsWith('@bounce.test')) throw new Error('Invalid `to` field.');
  mail.sent.push(o); return { id: `em_${mail.sent.length}` };
}) }));

import { db } from '@/lib/db';
import { POST as SEND } from '@/app/api/messages/send/route';
import { POST as INVITE } from '@/app/api/team/invite/route';

const RUN = `m${Date.now()}`;
let org: string, job: string, ok: string, out: string, bounce: string, other: string;
const send = (body: object) => SEND(new Request('http://x', { method: 'POST', body: JSON.stringify({ channel: 'email', recipientType: 'candidate', ...body }) }));

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Mail Co, LLC', shortName: 'Mail Co', slug: `m-${RUN}`, plan: 'growth', subscriptionStatus: 'active', ownerName: 'Pat Owner' } })).id;
  job = (await db.job.create({ data: { organizationId: org, title: 'Welder', location: 'Tampa, FL', payRate: 24 } })).id;
  ok = (await db.candidate.create({ data: { organizationId: org, name: 'Ana Diaz', email: 'ana@x.test' } })).id;
  out = (await db.candidate.create({ data: { organizationId: org, name: 'Opt Out', email: 'out@x.test', emailOptOut: true } })).id;
  bounce = (await db.candidate.create({ data: { organizationId: org, name: 'Bo Unce', email: 'bo@bounce.test' } })).id;
  const o2 = await db.organization.create({ data: { name: 'Other', slug: `n-${RUN}` } });
  other = (await db.candidate.create({ data: { organizationId: o2.id, name: 'Not Yours', email: 'no@x.test' } })).id;
  const u = await db.user.create({ data: { email: `r@${RUN}.test`, name: 'Rae Recruiter', passwordHash: 'x' } });
  await db.membership.create({ data: { userId: u.id, organizationId: org, role: 'ADMIN' } });
  session.current = { user: { id: u.id, orgId: org } };
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('email messaging', () => {
  it('sends one merged email per recipient, logs each outcome, and never reaches other orgs', async () => {
    const res = await send({ recipientIds: [ok, out, bounce, other], jobId: job, subject: '{{job_title}} for {{first_name}}', body: 'Hi {{first_name}}, {{job_title}} in {{job_location}} at {{pay_rate}}.\n{{signature}}' });
    expect(await res.json()).toEqual({ sent: 1, skipped: 1, failed: 1 });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: 'ana@x.test', subject: 'Welder for Ana', replyTo: `r@${RUN}.test`, fromName: 'Rae Recruiter at Mail Co' });
    expect(mail.sent[0].text).toBe('Hi Ana, Welder in Tampa, FL at $24/hr.\nPat Owner\nMail Co, LLC');
    const log = await db.message.findMany({ where: { organizationId: org }, orderBy: { toAddress: 'asc' } });
    expect(log.map((m) => [m.toAddress, m.status, m.subject])).toEqual([
      ['ana@x.test', 'sent', 'Welder for Ana'], ['bo@bounce.test', 'failed', 'Welder for Bo'], ['out@x.test', 'blocked_opt_out', 'Welder for Opt'],
    ]);
    expect(log.find((m) => m.status === 'failed')!.error).toBe('Invalid `to` field.');
  });

  it('holds back a message that still has an unfilled field', async () => {
    const before = mail.sent.length;
    expect(await (await send({ recipientIds: [ok], subject: 'Hi', body: 'Role in {{job_location}}' })).json()).toEqual({ sent: 0, skipped: 0, failed: 1 });
    expect(mail.sent.length).toBe(before);
    expect((await db.message.findFirstOrThrow({ where: { organizationId: org, body: 'Role in {{job_location}}' } })).error).toMatch(/No value for \{\{job_location\}\}/);
  });

  it('requires a subject for email', async () => {
    expect((await send({ recipientIds: [ok], body: 'x' })).status).toBe(400);
  });
});

describe('invite email', () => {
  it('is branded, and a bounce leaves no dangling invite', async () => {
    const good = await INVITE(new Request('http://x', { method: 'POST', body: JSON.stringify({ email: 'new@x.test', role: 'RECRUITER' }) }));
    expect(good.status).toBe(200);
    expect(mail.sent.at(-1)).toMatchObject({ to: 'new@x.test', fromName: 'Mail Co', subject: 'Rae Recruiter invited you to Mail Co on Preciops' });
    const bad = await INVITE(new Request('http://x', { method: 'POST', body: JSON.stringify({ email: 'ghost@bounce.test', role: 'RECRUITER' }) }));
    expect(bad.status).toBe(502);
    expect(await db.invite.count({ where: { organizationId: org, email: 'ghost@bounce.test' } })).toBe(0);
  });
});
