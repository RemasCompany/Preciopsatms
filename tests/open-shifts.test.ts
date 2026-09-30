import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const out = vi.hoisted(() => ({ texts: [] as { to: string; body: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ id: 'e' })) }));
vi.mock('@/lib/sms', () => ({ sendSms: vi.fn(async (to: string, body: string) => { out.texts.push({ to, body }); return { id: 's' }; }) }));

import { db } from '@/lib/db';
import { POST as CREATE } from '@/app/api/open-shifts/route';
import { DELETE as CANCEL } from '@/app/api/open-shifts/[id]/route';
import { GET as POOL } from '@/app/api/open-shifts/[id]/pool/route';
import { POST as OFFER } from '@/app/api/open-shifts/[id]/offer/route';
import { GET as PAGE, POST as ANSWER } from '@/app/api/public/shifts/[token]/route';

const RUN = `os${Date.now()}`;
let org: string, rec: string, job: string, otherJob: string;
const people: Record<string, { cand: string; app: string; phone: string }> = {};
const as = (u: string) => { session.current = { user: { id: u, orgId: org } }; };
const req = (method: string, body?: object) => new Request('http://x', { method, headers: { 'x-forwarded-for': '7.7.7.7' }, body: body ? JSON.stringify(body) : undefined });
const P = (id: string) => ({ params: { id } });
const T = (token: string) => ({ params: { token } });
const DAY = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
const tokenFor = (phone: string) => out.texts.filter((t) => t.to === phone).at(-1)!.body.match(/\/shifts\/([\w-]+)/)![1];

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Shift Co', shortName: 'ShiftCo', slug: `s-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  rec = (await db.user.create({ data: { email: `rec@${RUN}.test`, name: 'Rae', passwordHash: 'x' } })).id;
  await db.membership.create({ data: { userId: rec, organizationId: org, role: 'RECRUITER' } });
  job = (await db.job.create({ data: { organizationId: org, title: 'Forklift Operator', type: 'TEMP' } })).id;
  otherJob = (await db.job.create({ data: { organizationId: org, title: 'Line Cook', type: 'TEMP' } })).id;
  const add = async (name: string, phone: string, jobId = job) => {
    const cand = (await db.candidate.create({ data: { organizationId: org, name, phone } })).id;
    const app = (await db.application.create({ data: { organizationId: org, candidateId: cand, jobId, stage: 'PLACED' } })).id;
    people[name] = { cand, app, phone };
  };
  await add('Ana Diaz', '4075550001'); await add('Ben Cole', '4075550002'); await add('Cam Busy', '4075550003'); await add('Dee Other', '4075550004', otherJob);
  // Cam already works that day.
  await db.shift.create({ data: { organizationId: org, applicationId: people['Cam Busy'].app, date: new Date(`${DAY}T00:00:00Z`), start: '14:00', end: '22:00' } });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

let shiftId: string;
describe('open shifts', () => {
  it('are posted for a job and offered to its available pool', async () => {
    as(rec);
    expect((await (await CREATE(req('POST', { jobId: job, dates: ['2020-01-01'], start: '15:00', end: '23:30', breakMinutes: 30, slots: 1 }))).json()).error).toBe('That day has already passed.');
    expect((await CREATE(req('POST', { jobId: job, dates: [DAY], start: '15:00', end: '23:30', breakMinutes: 30, slots: 1, unit: 'Dock A' }))).status).toBe(201);
    shiftId = (await db.openShift.findFirst({ where: { organizationId: org } }))!.id;
    const { workers } = await (await POOL(req('GET'), P(shiftId))).json();
    expect(workers.map((w: { name: string; reason: string | null }) => [w.name, w.reason])).toEqual([['Ana Diaz', null], ['Ben Cole', null], ['Cam Busy', 'Already working then']]);
    out.texts = [];
    const r = await (await OFFER(req('POST', { channels: ['sms'] }), P(shiftId))).json();
    expect(r.sent).toBe(2);
    expect(out.texts.map((t) => t.to).sort()).toEqual(['4075550001', '4075550002']);
    expect(out.texts[0].body).toMatch(/^ShiftCo: open shift .* Forklift Operator · Dock A\. First to accept gets it: http/);
    expect((await (await OFFER(req('POST', { channels: ['sms'] }), P(shiftId))).json()).error).toBe('Everyone available has already been offered this shift.');
  });

  it('goes to the first to accept; the other sees it’s taken', async () => {
    const ana = tokenFor(people['Ana Diaz'].phone), ben = tokenFor(people['Ben Cole'].phone);
    const page = await (await PAGE(req('GET'), T(ana))).json();
    expect(page.offers).toEqual([expect.objectContaining({ status: 'open', date: DAY, start: '15:00', job: 'Forklift Operator', unit: 'Dock A' })]);
    const offerA = page.offers[0].id, offerB = (await (await PAGE(req('GET'), T(ben))).json()).offers[0].id;
    // Both tap at once: exactly one wins.
    const [a, b] = await Promise.all([ANSWER(req('POST', { offerId: offerA, accept: true }), T(ana)), ANSWER(req('POST', { offerId: offerB, accept: true }), T(ben))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect((await loser.json()).error).toBe('Sorry — someone else already took this shift.');
    const shifts = await db.shift.findMany({ where: { organizationId: org, date: new Date(`${DAY}T00:00:00Z`), start: '15:00' } });
    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toMatchObject({ response: 'CONFIRMED', notified: true, unit: 'Dock A' });
    expect(await db.openShift.findUnique({ where: { id: shiftId } })).toMatchObject({ status: 'FILLED', filled: 1 });
    const winner = shifts[0].applicationId === people['Ana Diaz'].app ? ana : ben, other = winner === ana ? ben : ana;
    expect((await (await PAGE(req('GET'), T(other))).json()).offers[0].status).toBe('taken');
    expect((await (await PAGE(req('GET'), T(winner))).json()).shifts).toEqual([expect.objectContaining({ date: DAY, state: 'confirmed' })]);
    // Offers are only answerable by their own worker.
    expect((await ANSWER(req('POST', { offerId: offerA, accept: true }), T(winner === ana ? ben : ana))).status).toBe(winner === ana ? 404 : 409);
  });

  it('fills several spots, then cancels with pending offers withdrawn', async () => {
    const d2 = new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10);
    await CREATE(req('POST', { jobId: job, dates: [d2], start: '07:00', end: '15:00', breakMinutes: 30, slots: 2 }));
    const id = (await db.openShift.findFirst({ where: { organizationId: org, date: new Date(`${d2}T00:00:00Z`) } }))!.id;
    out.texts = [];
    expect((await (await OFFER(req('POST', { channels: ['sms'] }), P(id))).json()).sent).toBe(3);
    expect(out.texts[0].body).toContain('2 spots, first come first served');
    const cam = tokenFor(people['Cam Busy'].phone), ana = tokenFor(people['Ana Diaz'].phone);
    const offerCam = (await (await PAGE(req('GET'), T(cam))).json()).offers.find((o: { date: string }) => o.date === d2).id;
    expect((await ANSWER(req('POST', { offerId: offerCam, accept: false }), T(cam))).status).toBe(200);
    const offerAna = (await (await PAGE(req('GET'), T(ana))).json()).offers.find((o: { date: string }) => o.date === d2).id;
    expect((await ANSWER(req('POST', { offerId: offerAna, accept: true }), T(ana))).status).toBe(200);
    expect(await db.openShift.findUnique({ where: { id } })).toMatchObject({ status: 'OPEN', filled: 1 });
    expect((await CANCEL(req('DELETE'), P(id))).status).toBe(200);
    expect(await db.shiftOffer.findMany({ where: { openShiftId: id }, orderBy: { status: 'asc' }, select: { status: true } })).toEqual([{ status: 'ACCEPTED' }, { status: 'CANCELLED' }, { status: 'DECLINED' }]);
    expect(await db.shift.count({ where: { organizationId: org, date: new Date(`${d2}T00:00:00Z`) } })).toBe(1); // Ana keeps hers
  });
});
