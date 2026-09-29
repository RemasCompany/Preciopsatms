import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const out = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; text: string }[], texts: [] as { to: string; body: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: { to: string; subject: string; text: string }) => { out.emails.push(o); return { id: 'e1' }; }) }));
vi.mock('@/lib/sms', () => ({ sendSms: vi.fn(async (to: string, body: string) => { out.texts.push({ to, body }); return { id: 's1' }; }) }));

import { db } from '@/lib/db';
import { POST as ADD } from '@/app/api/shifts/route';
import { PATCH, DELETE } from '@/app/api/shifts/[id]/route';
import { POST as PUBLISH } from '@/app/api/schedule/publish/route';
import { POST as COPY } from '@/app/api/schedule/copy/route';
import { GET as MINE, POST as RESPOND } from '@/app/api/public/shifts/[token]/route';
import { runShiftReminders } from '@/lib/schedule-server';
import { overlaps, restHours, scheduleNotice, shiftHours, weekDays, weekHours, type NoticeShift } from '@/lib/schedule';

describe('shift math', () => {
  it('counts paid hours, including overnight shifts', () => {
    expect(shiftHours({ start: '07:00', end: '19:00', breakMinutes: 30 })).toBe(11.5);
    expect(shiftHours({ start: '19:00', end: '07:00', breakMinutes: 30 })).toBe(11.5);
    expect(shiftHours({ start: '23:00', end: '07:30', breakMinutes: 0 })).toBe(8.5);
  });
  it('detects overlaps across midnight and short turnarounds', () => {
    const night = { date: '2026-10-05', start: '19:00', end: '07:00', breakMinutes: 0 };
    expect(overlaps(night, { date: '2026-10-06', start: '06:00', end: '10:00', breakMinutes: 0 })).toBe(true);
    expect(overlaps(night, { date: '2026-10-06', start: '07:00', end: '15:00', breakMinutes: 0 })).toBe(false);
    expect(restHours(night, { date: '2026-10-06', start: '11:00', end: '19:00', breakMinutes: 0 })).toBe(4);
  });
  it('splits the week at 40 hours', () => {
    expect(weekHours(Array(4).fill({ start: '07:00', end: '19:00', breakMinutes: 30 }))).toEqual({ total: 46, regular: 40, overtime: 6 });
    expect(weekDays('2026-10-11')).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
  });
  it('writes one merged notice with new, changed and cancelled shifts', () => {
    const s = (o: Partial<NoticeShift>): NoticeShift => ({ date: '2026-10-05', start: '07:00', end: '19:00', breakMinutes: 30, unit: 'ICU', notes: null, job: 'Travel RN', client: 'St. Mary’s', location: 'Austin, TX', cancelled: false, isNew: true, ...o });
    const first = scheduleNotice({ firstName: 'Maria', company: 'Care Staffing', shifts: [s({})], link: 'https://x/shifts/t', channel: 'email' });
    expect(first.subject).toBe('Your schedule with Care Staffing');
    expect(first.text).toContain('• Mon, Oct 5 · 7 AM – 7 PM (11.5h) · ICU');
    const upd = scheduleNotice({ firstName: 'Maria', company: 'Care Staffing', shifts: [s({ isNew: false, start: '08:00' }), s({ date: '2026-10-07', cancelled: true, isNew: false })], link: 'https://x/shifts/t', channel: 'email' });
    expect(upd.subject).toBe('Schedule update from Care Staffing');
    expect(upd.text).toMatch(/CHANGED: Mon, Oct 5 · 8 AM/);
    expect(upd.text).toMatch(/Cancelled — please don’t come in for:\n• Wed, Oct 7/);
    const text = scheduleNotice({ firstName: 'Maria', company: 'Care Staffing', shifts: [s({ start: '19:00', end: '07:00' })], link: 'https://x/shifts/t', channel: 'sms' });
    expect(text.text).toBe('Care Staffing: hi Maria, your shifts:\nMon, Oct 5 7p-7a ICU (St. Mary’s)\nConfirm: https://x/shifts/t');
  });
});

const RUN = `sc${Date.now()}`;
let org: string, other: string, lite: string, rec: string, viewer: string, outsider: string, liteUser: string;
let maria: { app: string; cand: string }, ben: { app: string }, maria2: string, otherApp: string, directHire: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const req = (method: string, body?: object) => new Request('http://x', { method, body: body ? JSON.stringify(body) : undefined });
const WEEK = '2026-10-11';
const add = (body: object) => ADD(req('POST', { start: '07:00', end: '19:00', breakMinutes: 30, ...body }));
const tokenFrom = (text: string) => text.match(/\/shifts\/([\w-]+)/)![1];

beforeAll(async () => {
  const mk = (n: string, plan: 'growth' | 'starter' = 'growth') => db.organization.create({ data: { name: n, slug: `${n.toLowerCase().replace(/\W/g, '')}-${RUN}`, plan, subscriptionStatus: 'active' } }).then((o) => o.id);
  [org, other, lite] = await Promise.all([mk('Care Staffing'), mk('Other'), mk('Lite', 'starter')]);
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [rec, viewer, outsider, liteUser] = await Promise.all([u('rec'), u('viewer'), u('outsider'), u('lite')]);
  await db.membership.createMany({ data: [
    { userId: rec, organizationId: org, role: 'RECRUITER' }, { userId: viewer, organizationId: org, role: 'VIEWER' },
    { userId: outsider, organizationId: other, role: 'OWNER' }, { userId: liteUser, organizationId: lite, role: 'OWNER' },
  ] });
  const client = await db.client.create({ data: { organizationId: org, name: 'St. Mary’s' } });
  const job = await db.job.create({ data: { organizationId: org, title: 'Travel RN', clientId: client.id, location: 'Austin, TX', type: 'CONTRACT' } });
  const job2 = await db.job.create({ data: { organizationId: org, title: 'Per diem RN', type: 'PER_DIEM' } });
  const dh = await db.job.create({ data: { organizationId: org, title: 'Nurse manager', type: 'DIRECT_HIRE' } });
  const c1 = await db.candidate.create({ data: { organizationId: org, name: 'Maria Garcia', email: 'maria@example.test', phone: '5125550101' } });
  const c2 = await db.candidate.create({ data: { organizationId: org, name: 'Ben Ode', email: 'ben@example.test', phone: '5125550102', emailOptOut: true } });
  const app = (candidateId: string, jobId: string, o = org) => db.application.create({ data: { organizationId: o, candidateId, jobId, stage: 'PLACED' } }).then((a) => a.id);
  maria = { app: await app(c1.id, job.id), cand: c1.id };
  ben = { app: await app(c2.id, job.id) };
  maria2 = await app(c1.id, job2.id);
  directHire = await app(c2.id, dh.id);
  const oc = await db.candidate.create({ data: { organizationId: other, name: 'Other' } });
  const oj = await db.job.create({ data: { organizationId: other, title: 'X' } });
  otherApp = await app(oc.id, oj.id, other);
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('building the schedule', () => {
  it('adds a shift on several days, as unsent drafts', async () => {
    as(rec);
    const r = await add({ applicationId: maria.app, dates: ['2026-10-05', '2026-10-06', '2026-10-07'], unit: 'ICU' });
    expect(r.status).toBe(201);
    expect((await r.json()).created).toBe(3);
    const rows = await db.shift.findMany({ where: { applicationId: maria.app } });
    expect(rows.every((s) => !s.notified && !s.notifiedAt)).toBe(true);
    expect(out.emails.length + out.texts.length).toBe(0);
  });

  it('refuses overlapping shifts, even on another assignment or overnight', async () => {
    as(rec);
    const r1 = await add({ applicationId: maria2, dates: ['2026-10-05'], start: '15:00', end: '23:00' });
    expect([r1.status, (await r1.json()).error]).toEqual([409, 'That overlaps their Mon, Oct 5 7a–7p shift (Travel RN).']);
    const night = await add({ applicationId: maria2, dates: ['2026-10-08'], start: '19:00', end: '07:00' });
    expect(night.status).toBe(201);
    const r2 = await add({ applicationId: maria.app, dates: ['2026-10-09'], start: '06:00', end: '10:00' });
    expect(r2.status).toBe(409);
  });

  it('warns about overtime and short turnarounds', async () => {
    as(rec);
    const r = await (await add({ applicationId: maria.app, dates: ['2026-10-09'], start: '11:00', end: '23:00' })).json();
    expect(r.warnings.join(' ')).toMatch(/57\.5 hours scheduled .* 17\.5 over 40 are overtime/);
    expect(r.warnings.join(' ')).toMatch(/Only 4 hours off before the Fri, Oct 9 shift/);
  });

  it('validates input with friendly errors', async () => {
    as(rec);
    const e = async (b: object) => (await (await add({ applicationId: ben.app, dates: ['2026-10-05'], ...b })).json()).error;
    expect(await e({ start: '7am' })).toBe('Enter a start time.');
    expect(await e({ end: '07:00' })).toBe('The shift has to end at a different time than it starts.');
    expect(await e({ start: '07:00', end: '07:20', breakMinutes: 30 })).toBe('The break is longer than the shift.');
    expect(await e({ dates: [] })).toBe('Choose at least one day.');
    expect((await add({ applicationId: directHire, dates: ['2026-10-05'] })).status).toBe(404);
  });

  it('is read-only for viewers, needs the plan, and stays inside the company', async () => {
    as(viewer);
    expect((await add({ applicationId: ben.app, dates: ['2026-10-05'] })).status).toBe(403);
    as(liteUser, lite);
    expect((await add({ applicationId: ben.app, dates: ['2026-10-05'] })).status).toBe(402);
    as(outsider, other);
    expect((await add({ applicationId: ben.app, dates: ['2026-10-05'] })).status).toBe(404);
    const s = (await db.shift.findFirst({ where: { applicationId: maria.app } }))!;
    expect((await PATCH(req('PATCH', { start: '08:00' }), { params: { id: s.id } })).status).toBe(404);
    expect((await DELETE(req('DELETE'), { params: { id: s.id } })).status).toBe(404);
    expect((await PUBLISH(req('POST', { week: WEEK, channels: ['email'] }))).status).toBe(400); // nothing of theirs to send
    as(rec);
    expect((await add({ applicationId: otherApp, dates: ['2026-10-05'] })).status).toBe(404);
  });
});

describe('publishing and notifying', () => {
  let token: string;
  it('sends each worker one message per channel and honors opt-outs', async () => {
    as(rec);
    await add({ applicationId: ben.app, dates: ['2026-10-05'], start: '19:00', end: '07:00' });
    out.emails = []; out.texts = [];
    const r = await PUBLISH(req('POST', { week: WEEK, channels: ['email', 'sms'] }));
    const { results } = await r.json();
    expect(results.map((x: { worker: string; shifts: number; delivered: string[] }) => [x.worker, x.shifts, x.delivered])).toEqual([
      ['Maria Garcia', 5, ['email', 'sms']], ['Ben Ode', 1, ['sms']],
    ]);
    expect(out.emails.map((m) => m.to)).toEqual(['maria@example.test']);
    expect(out.texts.map((m) => m.to)).toEqual(['5125550101', '5125550102']);
    const email = out.emails[0];
    expect(email.subject).toBe('Your schedule with Care Staffing');
    expect(email.text).toContain('Travel RN, St. Mary’s, Austin, TX');
    expect(email.text).toContain('Per diem RN');
    token = tokenFrom(email.text);
    expect(await db.message.count({ where: { organizationId: org, relatedType: 'candidate', status: 'blocked_opt_out' } })).toBe(1);
    expect(await db.shift.count({ where: { organizationId: org, notified: false } })).toBe(0);
    expect((await PUBLISH(req('POST', { week: WEEK, channels: ['email'] }))).status).toBe(400);
  });

  it('lets the worker see and confirm their shifts from the link', async () => {
    const res = await (await MINE(req('GET'), { params: { token } })).json();
    expect(res.firstName).toBe('Maria');
    expect(res.shifts).toHaveLength(5);
    const first = res.shifts[0];
    const r = await RESPOND(req('POST', { shiftId: first.id, response: 'CONFIRMED' }), { params: { token } });
    expect(r.status).toBe(200);
    expect((await db.shift.findUnique({ where: { id: first.id } }))!.response).toBe('CONFIRMED');
    const second = res.shifts[1];
    await RESPOND(req('POST', { shiftId: second.id, response: 'DECLINED', reason: 'Sick kid' }), { params: { token } });
    expect(await db.shift.findUnique({ where: { id: second.id } })).toMatchObject({ response: 'DECLINED', declineReason: 'Sick kid' });
    expect(await db.activity.count({ where: { organizationId: org, text: { contains: 'can’t make the Tue, Oct 6' } } })).toBe(1);
  });

  it('refuses other workers’ shifts and bad links', async () => {
    const bens = (await db.shift.findFirst({ where: { applicationId: ben.app } }))!;
    expect((await RESPOND(req('POST', { shiftId: bens.id, response: 'CONFIRMED' }), { params: { token } })).status).toBe(404);
    expect((await MINE(req('GET'), { params: { token: 'nope' } })).status).toBe(404);
    await db.workerLink.updateMany({ where: { organizationId: org }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await MINE(req('GET'), { params: { token } })).status).toBe(404);
    await db.workerLink.updateMany({ where: { organizationId: org }, data: { expiresAt: new Date(Date.now() + 864e5) } });
  });

  it('sends changes and cancellations with the next publish', async () => {
    as(rec);
    const [confirmed, , wed] = await db.shift.findMany({ where: { applicationId: maria.app }, orderBy: { date: 'asc' } });
    const p = await (await PATCH(req('PATCH', { start: '08:00' }), { params: { id: confirmed.id } })).json();
    expect(p.needsNotice).toBe(true);
    expect(await db.shift.findUnique({ where: { id: confirmed.id } })).toMatchObject({ notified: false, response: 'PENDING' });
    // The worker's page hides the unsent change.
    const view = await (await MINE(req('GET'), { params: { token } })).json();
    expect(view.shifts.find((s: { id: string }) => s.id === confirmed.id)).toMatchObject({ state: 'updating', start: '08:00' });
    expect((await RESPOND(req('POST', { shiftId: confirmed.id, response: 'CONFIRMED' }), { params: { token } })).status).toBe(409);
    expect((await (await DELETE(req('DELETE'), { params: { id: wed.id } })).json()).deleted).toBe(false);
    out.emails = []; out.texts = [];
    await PUBLISH(req('POST', { week: WEEK, channels: ['email'] }));
    expect(out.emails).toHaveLength(1);
    expect(out.emails[0].subject).toBe('Schedule update from Care Staffing');
    expect(out.emails[0].text).toMatch(/CHANGED: Mon, Oct 5 · 8 AM/);
    expect(out.emails[0].text).toMatch(/Cancelled — please don’t come in for:\n• Wed, Oct 7/);
    // A draft that was never sent is simply deleted.
    const draft = await (await add({ applicationId: ben.app, dates: ['2026-10-10'] })).json();
    expect(draft.created).toBe(1);
    const d = (await db.shift.findFirst({ where: { applicationId: ben.app, date: new Date('2026-10-10T00:00:00Z') } }))!;
    expect((await (await DELETE(req('DELETE'), { params: { id: d.id } })).json()).deleted).toBe(true);
  });

  it('marks nobody notified when a worker can’t be reached', async () => {
    as(rec);
    const c = await db.candidate.create({ data: { organizationId: org, name: 'No Contact' } });
    const job = (await db.job.findFirst({ where: { organizationId: org, title: 'Travel RN' } }))!;
    const a = await db.application.create({ data: { organizationId: org, candidateId: c.id, jobId: job.id, stage: 'PLACED' } });
    await add({ applicationId: a.id, dates: ['2026-10-05'] });
    const { results } = await (await PUBLISH(req('POST', { week: WEEK, channels: ['email', 'sms'] }))).json();
    expect(results).toEqual([{ worker: 'No Contact', shifts: 1, delivered: [], problems: ['no email address', 'no mobile number'] }]);
    expect((await db.shift.findFirst({ where: { applicationId: a.id } }))!.notified).toBe(false);
  });
});

describe('copying and reminders', () => {
  it('copies last week’s shifts as drafts, skipping overlaps', async () => {
    as(rec);
    await add({ applicationId: ben.app, dates: ['2026-09-28', '2026-09-29'], start: '09:00', end: '17:00' });
    await add({ applicationId: ben.app, dates: ['2026-10-06'], start: '12:00', end: '20:00' }); // overlaps the copy of Sep 29
    const before = await db.shift.count({ where: { applicationId: ben.app } });
    const r = await (await COPY(req('POST', { week: WEEK }))).json();
    expect(r).toMatchObject({ skipped: 1 });
    expect(r.copied).toBe(1);
    // Monday 9–5 fits before Ben's 7pm overnight shift; Tuesday's copy would overlap his 12–8.
    expect(await db.shift.count({ where: { applicationId: ben.app, date: new Date('2026-10-05T00:00:00Z'), start: '09:00', notified: false } })).toBe(1);
    expect(await db.shift.count({ where: { applicationId: ben.app } })).toBe(before + r.copied);
  });

  it('texts a reminder the day before, once, and skips declined shifts', async () => {
    out.emails = []; out.texts = [];
    const r = await runShiftReminders(new Date('2026-10-05T22:00:00Z'));
    // Tomorrow is Tue Oct 6: Maria declined hers; Ben's Oct 6 shift was never published.
    expect(r.sent).toBe(0);
    await runShiftReminders(new Date('2026-10-07T22:00:00Z')); // Thu Oct 8: Maria's overnight per diem shift
    expect(out.texts.map((t) => t.to)).toEqual(['5125550101']);
    expect(out.texts[0].body).toMatch(/^Care Staffing: reminder, you work tomorrow 7p-7a at Per diem RN\. Details: http/);
    await runShiftReminders(new Date('2026-10-07T22:30:00Z'));
    expect(out.texts).toHaveLength(1);
  });
});
