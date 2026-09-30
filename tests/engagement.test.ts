import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const out = vi.hoisted(() => ({ texts: [] as { to: string; body: string }[], emails: [] as { to: string; subject: string; text: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: { to: string; subject: string; text: string }) => { out.emails.push(o); return { id: 'e' }; }) }));
vi.mock('@/lib/sms', () => ({ sendSms: vi.fn(async (to: string, body: string) => { out.texts.push({ to, body }); return { id: 's' }; }) }));

import { db } from '@/lib/db';
import { newToken, sha256 } from '@/lib/tokens';
import { POST as RECOGNIZE } from '@/app/api/engagement/recognitions/route';
import { POST as LOG } from '@/app/api/engagement/feedback/route';
import { POST as ASK } from '@/app/api/engagement/feedback-requests/route';
import { PATCH as BIRTHDAY } from '@/app/api/engagement/birthday/route';
import { PATCH as SETTINGS } from '@/app/api/engagement/settings/route';
import { POST as WORKER } from '@/app/api/public/engagement/[token]/route';
import { GET as CLIENT_GET, POST as CLIENT_POST } from '@/app/api/public/feedback/[token]/route';
import { GET as PAGE } from '@/app/api/public/shifts/[token]/route';
import { runBirthdayGreetings } from '@/lib/engagement-server';
import { milestonesFor, nextBirthday, summarize, upcomingBirthdays, validBirthday } from '@/lib/engagement';
import { localDate } from '@/lib/timeclock';

describe('birthdays and milestones', () => {
  it('finds the next birthday, with Feb 29 on Feb 28 in other years', () => {
    expect(nextBirthday(10, 3, '2026-09-30')).toBe('2026-10-03');
    expect(nextBirthday(9, 1, '2026-09-30')).toBe('2027-09-01');
    expect(nextBirthday(2, 29, '2026-09-30')).toBe('2027-02-28');
    expect(nextBirthday(2, 29, '2027-03-01')).toBe('2028-02-29');
    expect([validBirthday(2, 29), validBirthday(2, 30), validBirthday(13, 1)]).toEqual([true, false, false]);
  });
  it('lists upcoming birthdays soonest first and never needs a year', () => {
    const r = upcomingBirthdays([{ n: 'a', birthMonth: 10, birthDay: 20 }, { n: 'b', birthMonth: 9, birthDay: 30 }, { n: 'c', birthMonth: null, birthDay: null }, { n: 'd', birthMonth: 12, birthDay: 25 }], '2026-09-30');
    expect(r.map((x) => [x.n, x.inDays])).toEqual([['b', 0], ['a', 20]]);
  });
  it('spots assignment anniversaries', () => {
    expect(milestonesFor('2026-07-02', '2026-09-30').map((m) => m.days)).toEqual([90]); // 90 days is Sep 30
    expect(milestonesFor('2025-09-30', '2026-09-30').map((m) => [m.days, m.inDays])).toEqual([[365, 0]]);
    expect(milestonesFor('2025-10-05', '2026-09-30').map((m) => [m.days, m.inDays])).toEqual([[365, 5]]);
  });
  it('summarizes ratings', () => {
    expect(summarize([5, 4, 1, 2])).toEqual({ count: 4, average: 3, low: 2 });
    expect(summarize([])).toEqual({ count: 0, average: null, low: 0 });
  });
});

const RUN = `en${Date.now()}`;
let org: string, other: string, admin: string, rec: string, outsider: string, cand: string, app: string, benched: string, contact: string, token: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const req = (method: string, body?: object) => new Request('http://x', { method, body: body ? JSON.stringify(body) : undefined });
const t = (tok = token) => ({ params: { token: tok } });

beforeAll(async () => {
  const mk = (n: string) => db.organization.create({ data: { name: `${n} Staffing`, shortName: n, slug: `${n}-${RUN}`, plan: 'growth', subscriptionStatus: 'active', timezone: 'America/Chicago' } }).then((o) => o.id);
  [org, other] = await Promise.all([mk('care'), mk('other')]);
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [admin, rec, outsider] = await Promise.all([u('admin'), u('rec'), u('out')]);
  await db.membership.createMany({ data: [{ userId: admin, organizationId: org, role: 'ADMIN' }, { userId: rec, organizationId: org, role: 'RECRUITER' }, { userId: outsider, organizationId: other, role: 'OWNER' }] });
  const client = await db.client.create({ data: { organizationId: org, name: 'Harbor Point' } });
  contact = (await db.contact.create({ data: { organizationId: org, clientId: client.id, name: 'Rita Alvarez', email: 'rita@harbor.test' } })).id;
  const job = await db.job.create({ data: { organizationId: org, clientId: client.id, title: 'Forklift Operator', type: 'TEMP' } });
  cand = (await db.candidate.create({ data: { organizationId: org, name: 'James Carter', phone: '4075550202', email: 'james@example.test' } })).id;
  app = (await db.application.create({ data: { organizationId: org, candidateId: cand, jobId: job.id, stage: 'PLACED' } })).id;
  benched = (await db.candidate.create({ data: { organizationId: org, name: 'Just Applied' } })).id;
  await db.application.create({ data: { organizationId: org, candidateId: benched, jobId: job.id, stage: 'APPLIED' } });
  token = newToken();
  await db.workerLink.create({ data: { organizationId: org, candidateId: cand, tokenHash: sha256(token), kind: 'timeclock', expiresAt: new Date(Date.now() + 864e5) } });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('recognition', () => {
  it('saves, texts the worker and shows on their page', async () => {
    as(rec);
    expect((await (await RECOGNIZE(req('POST', { candidateId: cand, kind: 'safety', message: 'ok' }))).json()).error).toBe('Say what they did — it means more.');
    out.texts = [];
    const r = await (await RECOGNIZE(req('POST', { candidateId: cand, applicationId: app, kind: 'safety', message: 'You spotted a blocked fire exit and reported it right away. Thank you!', channels: ['sms'] }))).json();
    expect(r.sent).toEqual(['sms']);
    expect(out.texts[0].body).toBe('care: 🦺 Safety star, James! You spotted a blocked fire exit and reported it right away. Thank you!');
    const page = await (await PAGE(req('GET'), t())).json();
    expect(page.engagement.recognitions[0]).toMatchObject({ kind: 'safety' });
    as(outsider, other);
    expect((await RECOGNIZE(req('POST', { candidateId: cand, kind: 'safety', message: 'Nice work there' }))).status).toBe(404);
  });
});

describe('the worker’s pulse and birthday', () => {
  it('asks how it’s going, flags low ratings, then waits two weeks', async () => {
    expect((await (await PAGE(req('GET'), t())).json()).engagement.askPulse).toBe(true);
    const r = await (await WORKER(req('POST', { action: 'pulse', rating: 2, comment: 'Forklift keeps breaking down' }), t())).json();
    expect(r.message).toBe('Thanks for telling us. Your recruiter will reach out soon.');
    expect(await db.activity.count({ where: { organizationId: org, text: { contains: 'rated their Forklift Operator assignment 2/5 — follow up' } } })).toBe(1);
    expect((await (await PAGE(req('GET'), t())).json()).engagement.askPulse).toBe(false);
    expect((await (await WORKER(req('POST', { action: 'pulse', rating: 9 }), t())).json()).error).toBe('Choose a rating.');
  });

  it('keeps only month and day, and only for people on assignment', async () => {
    expect((await (await WORKER(req('POST', { action: 'birthday', month: 2, day: 30 }), t())).json()).error).toBe('Choose a valid month and day.');
    expect((await WORKER(req('POST', { action: 'birthday', month: 3, day: 14 }), t())).status).toBe(200);
    expect(await db.candidate.findUnique({ where: { id: cand } })).toMatchObject({ birthMonth: 3, birthDay: 14 });
    as(rec);
    const r = await BIRTHDAY(req('PATCH', { candidateId: benched, month: 1, day: 1 }));
    expect([r.status, (await r.json()).error]).toEqual([409, 'Birthdays are only kept for people on assignment.']);
  });
});

describe('client feedback', () => {
  it('emails the contact a one-time link and records the rating', async () => {
    as(rec);
    out.emails = [];
    expect((await ASK(req('POST', { applicationId: app, contactId: contact }))).status).toBe(201);
    expect(out.emails[0]).toMatchObject({ to: 'rita@harbor.test', subject: 'How is James Carter doing?' });
    const link = out.emails[0].text.match(/\/feedback\/([\w-]+)/)![1];
    expect(await (await CLIENT_GET(req('GET'), t(link))).json()).toMatchObject({ worker: 'James Carter', contact: 'Rita Alvarez', client: 'Harbor Point' });
    expect((await (await CLIENT_POST(req('POST', { rating: 4 }), t(link))).json()).error).toBe('Tell us whether you’d have them back.');
    expect((await (await CLIENT_POST(req('POST', { wouldRehire: true }), t(link))).json()).error).toBe('Choose a rating.');
    expect((await CLIENT_POST(req('POST', { rating: 4, wouldRehire: true, comment: 'Reliable and safe' }), t(link))).status).toBe(200);
    expect(await db.feedback.findFirst({ where: { organizationId: org, source: 'CLIENT' } })).toMatchObject({ rating: 4, wouldRehire: true, authorName: 'Rita Alvarez' });
    expect((await CLIENT_POST(req('POST', { rating: 1, wouldRehire: false }), t(link))).status).toBe(404); // used
  });

  it('lets staff log feedback they heard', async () => {
    as(rec);
    expect((await LOG(req('POST', { candidateId: cand, applicationId: app, rating: 5, from: 'Night supervisor', comment: 'Best on the crew' }))).status).toBe(201);
    as(outsider, other);
    expect((await ASK(req('POST', { applicationId: app, contactId: contact }))).status).toBe(404);
    expect((await LOG(req('POST', { candidateId: cand, rating: 5 }))).status).toBe(404);
  });
});

describe('birthday greetings', () => {
  it('are off until an admin turns them on, then go out once a year', async () => {
    const now = new Date();
    const today = localDate(now, 'America/Chicago');
    await db.candidate.updateMany({ where: { id: cand }, data: { birthMonth: Number(today.slice(5, 7)), birthDay: Number(today.slice(8, 10)), lastGreetedYear: null } });
    out.texts = [];
    await runBirthdayGreetings(now);
    expect(out.texts.filter((m) => m.to === '4075550202')).toHaveLength(0);
    as(rec);
    expect((await SETTINGS(req('PATCH', { birthdayGreetings: true }))).status).toBe(403);
    as(admin);
    expect((await SETTINGS(req('PATCH', { birthdayGreetings: true }))).status).toBe(200);
    await runBirthdayGreetings(now);
    expect(out.texts.filter((m) => m.to === '4075550202').map((m) => m.body)).toEqual(['care: Happy birthday, James! 🎂 Thanks for all you do — we hope you have a great day.']);
    await runBirthdayGreetings(now);
    expect(out.texts.filter((m) => m.to === '4075550202')).toHaveLength(1);
  });
});
