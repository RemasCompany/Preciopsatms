import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const out = vi.hoisted(() => ({ texts: [] as { to: string; body: string }[], emails: [] as { to: string; text: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: { to: string; text: string }) => { out.emails.push(o); return { id: 'e' }; }) }));
vi.mock('@/lib/sms', () => ({ sendSms: vi.fn(async (to: string, body: string) => { out.texts.push({ to, body }); return { id: 's' }; }) }));

import { db } from '@/lib/db';
import { newToken, sha256 } from '@/lib/tokens';
import { POST as PUNCH } from '@/app/api/public/clock/[token]/route';
import { GET as PAGE } from '@/app/api/public/shifts/[token]/route';
import { POST as ADD } from '@/app/api/timeclock/entries/route';
import { PATCH as EDIT, DELETE as DEL } from '@/app/api/timeclock/entries/[id]/route';
import { POST as FILL } from '@/app/api/timeclock/fill/route';
import { POST as LINK } from '@/app/api/timeclock/link/route';
import { entryFlags, localDate, localTime, splitWeek, weekEndingOf, workedMinutes, zonedToUtc, type Entry } from '@/lib/timeclock';

const NY = 'America/New_York', LA = 'America/Los_Angeles';

describe('time zones', () => {
  it('converts wall-clock times, including across daylight saving', () => {
    expect(zonedToUtc('2026-07-01', '07:00', NY).toISOString()).toBe('2026-07-01T11:00:00.000Z');
    expect(zonedToUtc('2026-01-15', '07:00', NY).toISOString()).toBe('2026-01-15T12:00:00.000Z');
    expect(zonedToUtc('2026-03-08', '03:30', NY).toISOString()).toBe('2026-03-08T07:30:00.000Z'); // just after spring-forward
    expect(zonedToUtc('2026-11-01', '12:00', LA).toISOString()).toBe('2026-11-01T20:00:00.000Z');
  });
  it('puts late-night punches on the local day and week', () => {
    const d = new Date('2026-10-05T03:30:00Z'); // Sun Oct 4, 11:30 PM in New York
    expect([localDate(d, NY), localTime(d, NY), weekEndingOf(localDate(d, NY))]).toEqual(['2026-10-04', '23:30', '2026-10-04']);
  });
});

describe('hours', () => {
  const e = (o: Partial<Entry>): Entry => ({ id: Math.random().toString(), applicationId: 'a1', candidateId: 'c1', clockIn: new Date('2026-09-28T11:00:00Z'), clockOut: new Date('2026-09-28T23:30:00Z'), breakMinutes: 30, ...o });
  it('subtracts breaks, including one still running', () => {
    expect(workedMinutes(e({}))).toBe(720);
    expect(workedMinutes(e({ clockOut: null, breakMinutes: 0, breakStartedAt: new Date('2026-09-28T15:00:00Z') }), new Date('2026-09-28T15:20:00Z'))).toBe(240);
  });
  it('counts overtime across assignments in the order it was worked', () => {
    const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'];
    const entries = [
      ...days.map((d) => e({ clockIn: new Date(`${d}T11:00:00Z`), clockOut: new Date(`${d}T21:30:00Z`) })), // 4 × 10h on a1
      e({ applicationId: 'a2', clockIn: new Date('2026-10-02T12:00:00Z'), clockOut: new Date('2026-10-02T18:30:00Z') }), // 6h on a2 → all overtime
    ];
    expect(splitWeek(entries, NY).map((r) => [r.applicationId, r.weekEnding, r.regularHours, r.overtimeHours])).toEqual([['a1', '2026-10-04', 40, 0], ['a2', '2026-10-04', 0, 6]]);
  });
  it('flags late arrivals, missed clock-outs and long shifts without a break', () => {
    const late = entryFlags({ ...e({ clockIn: new Date('2026-09-28T11:12:00Z'), breakMinutes: 0 }), shift: { date: '2026-09-28', start: '07:00', end: '19:30' } }, NY, new Date('2026-09-29T00:00:00Z'));
    expect(late.map((f) => f.text)).toEqual(['12 min late', 'No break over 6 hours']);
    const open = entryFlags({ ...e({ clockOut: null }), shift: null }, NY, new Date('2026-09-29T05:00:00Z'));
    expect(open.map((f) => f.text)).toEqual(['Missed clock-out', 'No scheduled shift']);
  });
});

const RUN = `tc${Date.now()}`;
let org: string, other: string, lite: string, rec: string, outsider: string, cand: string, cand2: string, appA: string, appB: string, app2: string, token: string, liteToken: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const req = (method: string, body?: object) => new Request('http://x', { method, body: body ? JSON.stringify(body) : undefined });
const punch = (action: string, extra: object = {}, t = token) => PUNCH(req('POST', { action, ...extra }), { params: { token: t } });
const mkLink = async (orgId: string, candidateId: string, extra: object = {}) => {
  const t = newToken();
  await db.workerLink.create({ data: { organizationId: orgId, candidateId, tokenHash: sha256(t), kind: 'timeclock', expiresAt: new Date(Date.now() + 864e5), ...extra } });
  return t;
};

beforeAll(async () => {
  const mk = (n: string, plan: 'growth' | 'starter') => db.organization.create({ data: { name: n, slug: `${n}-${RUN}`, plan, subscriptionStatus: 'active', timezone: NY } }).then((o) => o.id);
  [org, other, lite] = await Promise.all([mk('care', 'growth'), mk('other', 'growth'), mk('lite', 'starter')]);
  rec = (await db.user.create({ data: { email: `rec@${RUN}.test`, name: 'Rec', passwordHash: 'x' } })).id;
  outsider = (await db.user.create({ data: { email: `out@${RUN}.test`, passwordHash: 'x' } })).id;
  await db.membership.createMany({ data: [{ userId: rec, organizationId: org, role: 'RECRUITER' }, { userId: outsider, organizationId: other, role: 'OWNER' }] });
  const j1 = await db.job.create({ data: { organizationId: org, title: 'Travel RN', type: 'CONTRACT', payRate: 58, billRate: 82 } });
  const j2 = await db.job.create({ data: { organizationId: org, title: 'Per diem RN', type: 'PER_DIEM', payRate: 60, billRate: 85 } });
  cand = (await db.candidate.create({ data: { organizationId: org, name: 'Maria Garcia', phone: '5125550101', email: 'maria@example.test' } })).id;
  cand2 = (await db.candidate.create({ data: { organizationId: org, name: 'Ben Ode', phone: '5125550102' } })).id;
  appA = (await db.application.create({ data: { organizationId: org, candidateId: cand, jobId: j1.id, stage: 'PLACED' } })).id;
  appB = (await db.application.create({ data: { organizationId: org, candidateId: cand, jobId: j2.id, stage: 'PLACED' } })).id;
  app2 = (await db.application.create({ data: { organizationId: org, candidateId: cand2, jobId: j1.id, stage: 'PLACED' } })).id;
  token = await mkLink(org, cand);
  const lc = await db.candidate.create({ data: { organizationId: lite, name: 'Lite' } });
  liteToken = await mkLink(lite, lc.id);
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('worker punches', () => {
  it('needs the plan, a live link and the assignment when there are two', async () => {
    expect((await punch('in', {}, liteToken)).status).toBe(402);
    expect((await punch('in', {}, 'nope')).status).toBe(404);
    const r = await punch('in');
    expect([r.status, (await r.json()).error]).toEqual([400, 'Choose the assignment you’re working.']);
  });

  it('clocks in (matched to today’s shift), takes a break and clocks out', async () => {
    const now = new Date(), startAt = new Date(now.getTime() - 30 * 60000);
    // The shift's local date is the day it starts, so this holds even just after midnight.
    await db.shift.create({ data: { organizationId: org, applicationId: appA, date: new Date(`${localDate(startAt, NY)}T00:00:00Z`), start: localTime(startAt, NY), end: localTime(new Date(now.getTime() + 8 * 3600e3), NY), notified: true, notifiedAt: now } });
    const r = await punch('in', { applicationId: appA, geo: { lat: 30.27, lng: -97.74, accuracy: 12 } });
    expect(r.status).toBe(200);
    expect((await r.json()).message).toMatch(/^Clocked in at /);
    const e = (await db.timeEntry.findFirst({ where: { applicationId: appA } }))!;
    expect(e).toMatchObject({ inLat: 30.27, inAccuracy: 12, source: 'WORKER' });
    expect(e.shiftId).not.toBeNull();
    expect((await (await punch('in', { applicationId: appB })).json()).error).toBe('You’re already clocked in. Clock out first.');
    expect((await punch('break-start')).status).toBe(200);
    expect((await (await punch('break-start')).json()).error).toBe('You’re already on a break.');
    // Pretend the break started 20 minutes ago.
    await db.timeEntry.updateMany({ where: { id: e.id }, data: { breakStartedAt: new Date(Date.now() - 20 * 60000), clockIn: new Date(Date.now() - 3 * 3600e3) } });
    expect((await (await punch('break-end')).json()).message).toBe('Back from a 20-minute break.');
    const page = await (await PAGE(req('GET'), { params: { token } })).json();
    expect(page.clock).toMatchObject({ timezone: NY, open: { applicationId: appA, onBreak: false, breakMinutes: 20 } });
    expect(page.clock.assignments).toHaveLength(2);
    const o = await (await punch('out')).json();
    expect(o.message).toMatch(/You worked 2h 40m\./);
    expect((await (await punch('out')).json()).error).toBe('You’re not clocked in.');
  });

  it('stops working when the link is replaced', async () => {
    as(rec);
    out.texts = [];
    const r = await (await LINK(req('POST', { candidateId: cand, channels: ['sms'] }))).json();
    expect(r.sent).toEqual(['sms']);
    expect(out.texts[0].body).toMatch(/^care: hi Maria, clock in and out for your shifts here \(save this link\): http.*\/shifts\//);
    expect((await punch('in', { applicationId: appA })).status).toBe(404); // old link revoked
    token = out.texts[0].body.match(/\/shifts\/([\w-]+)/)![1];
    expect((await (await PAGE(req('GET'), { params: { token } })).json()).firstName).toBe('Maria');
  });
});

describe('staff corrections', () => {
  const mon = '2026-09-21', sun = '2026-09-27';
  let entryId: string;
  it('adds a missed punch with a reason, and refuses overlaps and bad times', async () => {
    as(rec);
    const add = (b: object) => ADD(req('POST', { applicationId: appA, inDate: mon, inTime: '07:00', outDate: mon, outTime: '19:30', breakMinutes: 30, reason: 'Phone died', ...b }));
    expect((await (await add({ reason: '' })).json()).error).toBe('Say why (e.g. “Forgot to clock out”). It’s kept with the entry.');
    expect((await (await add({ outTime: '06:00' })).json()).error).toBe('Clock-out has to be after clock-in.');
    expect((await (await add({ inDate: '2030-01-01', outDate: '2030-01-01' })).json()).error).toBe('The clock-in can’t be in the future.');
    const r = await add({});
    expect(r.status).toBe(201);
    entryId = (await r.json()).id;
    expect((await db.timeEntry.findUnique({ where: { id: entryId } }))!.clockIn.toISOString()).toBe('2026-09-21T11:00:00.000Z');
    const clash = await add({ applicationId: appB, inTime: '18:00', outTime: '22:00' });
    expect(clash.status).toBe(409);
  });

  it('edits keep the worker’s original times; deletes are logged', async () => {
    as(rec);
    const w = await db.timeEntry.create({ data: { organizationId: org, applicationId: appA, clockIn: new Date('2026-09-22T11:05:00Z'), clockOut: new Date('2026-09-22T23:40:00Z'), breakMinutes: 0 } });
    expect((await EDIT(req('PATCH', { inDate: '2026-09-22', inTime: '07:00', outDate: '2026-09-22', outTime: '19:30', breakMinutes: 30, reason: 'Clocked in late at the kiosk; supervisor confirmed' }), { params: { id: w.id } })).status).toBe(200);
    expect(await db.timeEntry.findUnique({ where: { id: w.id } })).toMatchObject({ originalClockIn: new Date('2026-09-22T11:05:00Z'), breakMinutes: 30, editReason: 'Clocked in late at the kiosk; supervisor confirmed' });
    const tmp = await db.timeEntry.create({ data: { organizationId: org, applicationId: appA, clockIn: new Date('2026-09-26T11:00:00Z'), clockOut: new Date('2026-09-26T12:00:00Z') } });
    expect((await DEL(req('DELETE', { reason: '' }), { params: { id: tmp.id } })).status).toBe(400);
    expect((await DEL(req('DELETE', { reason: 'Test punch' }), { params: { id: tmp.id } })).status).toBe(200);
    expect(await db.activity.count({ where: { organizationId: org, text: { contains: 'Test punch' } } })).toBe(1);
  });

  it('fills timesheets with overtime split across assignments, and then locks the week', async () => {
    as(rec);
    for (const d of ['2026-09-23', '2026-09-24']) await db.timeEntry.create({ data: { organizationId: org, applicationId: appA, clockIn: new Date(`${d}T11:00:00Z`), clockOut: new Date(`${d}T23:30:00Z`), breakMinutes: 30 } });
    await db.timeEntry.create({ data: { organizationId: org, applicationId: appB, clockIn: new Date('2026-09-26T13:00:00Z'), clockOut: new Date('2026-09-26T21:00:00Z') } });
    await db.timeEntry.create({ data: { organizationId: org, applicationId: app2, clockIn: new Date('2026-09-25T11:00:00Z'), clockOut: new Date('2026-09-25T19:00:00Z') } });
    const r = await (await FILL(req('POST', { week: sun }))).json();
    expect(r).toMatchObject({ filled: 3, locked: [], openEntries: [] });
    const ts = await db.timesheet.findMany({ where: { organizationId: org, weekEnding: new Date(`${sun}T00:00:00Z`) }, orderBy: { payRate: 'asc' } });
    // Maria: 4 × 12h = 48h on Travel RN (40 reg + 8 OT), then 8h per diem Saturday, all overtime. Ben: 8h.
    expect(ts.map((t) => [Number(t.payRate), Number(t.regularHours), Number(t.overtimeHours)])).toEqual([[58, 40, 8], [58, 8, 0], [60, 0, 8]]);
    await db.timesheet.updateMany({ where: { applicationId: appA, weekEnding: new Date(`${sun}T00:00:00Z`) }, data: { status: 'APPROVED' } });
    const locked = await EDIT(req('PATCH', { inDate: mon, inTime: '08:00', outDate: mon, outTime: '19:30', breakMinutes: 30, reason: 'Late' }), { params: { id: entryId } });
    expect([locked.status, (await locked.json()).error]).toEqual([409, 'That week’s timesheet is already approved. Reopen it before changing punches.']);
    expect((await (await FILL(req('POST', { week: sun }))).json()).locked).toEqual(['Maria Garcia']);
  });

  it('never reaches another company’s punches', async () => {
    as(outsider, other);
    expect((await EDIT(req('PATCH', { inDate: '2026-09-25', inTime: '07:00', outDate: '2026-09-25', outTime: '15:00', breakMinutes: 0, reason: 'Nope' }), { params: { id: entryId } })).status).toBe(404);
    expect((await ADD(req('POST', { applicationId: app2, inDate: '2026-09-25', inTime: '07:00', outDate: '2026-09-25', outTime: '15:00', breakMinutes: 0, reason: 'Nope' }))).status).toBe(404);
    expect((await LINK(req('POST', { candidateId: cand, channels: ['sms'] }))).status).toBe(404);
  });
});
