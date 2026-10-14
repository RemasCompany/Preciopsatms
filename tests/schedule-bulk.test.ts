import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ id: 'e1' })) }));
vi.mock('@/lib/sms', () => ({ sendSms: vi.fn(async () => ({ id: 's1' })) }));

import { db } from '@/lib/db';
import { POST, PATCH, DELETE } from '@/app/api/shifts/bulk/route';

const RUN = `sb${Date.now()}`;
let org: string, other: string, rec: string, viewer: string;
let ana: string, ben: string, cal: string, dee: string, otherApp: string, anaCand: string;
const as = (u: string, o = org) => { session.current = { user: { id: u, orgId: o } }; };
const req = (method: string, body?: object) => new Request('http://x', { method, body: body ? JSON.stringify(body) : undefined });
const WEEK = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
const plan = (o: object) => POST(req('POST', { start: '07:00', end: '17:30', breakMinutes: 30, ...o }));
vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-02T15:00:00Z') });
afterAll(() => { vi.useRealTimers(); });

beforeAll(async () => {
  const mk = (n: string) => db.organization.create({ data: { name: n, slug: `${n.toLowerCase()}-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } }).then((o) => o.id);
  [org, other] = await Promise.all([mk('Bulk'), mk('Other')]);
  const u = (n: string) => db.user.create({ data: { email: `${n}@${RUN}.test`, name: n, passwordHash: 'x' } }).then((x) => x.id);
  [rec, viewer] = await Promise.all([u('rec'), u('viewer')]);
  await db.membership.createMany({ data: [{ userId: rec, organizationId: org, role: 'RECRUITER' }, { userId: viewer, organizationId: org, role: 'VIEWER' }] });
  const client = await db.client.create({ data: { organizationId: org, name: 'Acme Warehouse' } });
  const job = await db.job.create({ data: { organizationId: org, title: 'Picker', clientId: client.id, type: 'CONTRACT' } });
  const cand = (name: string, o = org) => db.candidate.create({ data: { organizationId: o, name } }).then((c) => c.id);
  const app = (candidateId: string, o = org, jobId = job.id) => db.application.create({ data: { organizationId: o, candidateId, jobId, stage: 'PLACED' } }).then((a) => a.id);
  anaCand = await cand('Ana');
  [ana, ben, cal, dee] = [await app(anaCand), await app(await cand('Ben')), await app(await cand('Cal')), await app(await cand('Dee'))];
  const deeApp = await db.application.findFirstOrThrow({ where: { id: dee } });
  await db.doNotReturn.create({ data: { organizationId: org, candidateId: deeApp.candidateId, clientId: client.id, reason: 'No-show' } });
  const oj = await db.job.create({ data: { organizationId: other, title: 'X' } });
  otherApp = await app(await cand('Outsider', other), other, oj.id);
  // Cal already works Wednesday.
  await db.shift.create({ data: { organizationId: org, applicationId: cal, date: new Date('2026-10-14T00:00:00Z'), start: '08:00', end: '12:00' } });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('create schedule', () => {
  it('previews a week for several workers without saving anything', async () => {
    as(rec);
    const r = await plan({ dryRun: true, applicationIds: [ana, ben, cal, dee, otherApp], dates: WEEK });
    expect(r.status).toBe(200);
    const { items } = await r.json();
    const by = (id: string) => items.find((i: { applicationId: string }) => i.applicationId === id);
    expect(by(ana)).toMatchObject({ worker: 'Ana', hours: 50, blocked: null });
    expect(by(ana).warnings.join(' ')).toMatch(/50 hours the week ending Oct 18 — 10 over 40 are overtime/);
    expect(by(cal).blocked).toBe('Already working Wed, Oct 14 8a–12p (Picker).');
    expect(by(dee).blocked).toBe('On Acme Warehouse’s do-not-return list.');
    expect(by(otherApp)).toMatchObject({ worker: 'Unknown', blocked: 'No longer on this assignment.' });
    expect(await db.shift.count({ where: { organizationId: org } })).toBe(1);
  });

  it('adds nothing while anyone in the batch is blocked, then everything once they are removed', async () => {
    as(rec);
    const bad = await plan({ applicationIds: [ana, cal], dates: WEEK });
    expect(bad.status).toBe(409);
    expect((await bad.json()).error).toMatch(/^Remove this worker first — Cal: Already working/);
    expect(await db.shift.count({ where: { organizationId: org } })).toBe(1);
    const ok = await plan({ applicationIds: [ana, ben], dates: WEEK.slice(0, 4), unit: 'Dock 2' });
    expect(ok.status).toBe(201);
    expect((await ok.json()).created).toBe(8);
    const rows = await db.shift.findMany({ where: { applicationId: { in: [ana, ben] } } });
    expect(rows.every((s) => s.unit === 'Dock 2' && !s.notified && s.organizationId === org)).toBe(true);
  });

  it('checks the batch against itself: the same person on two assignments', async () => {
    as(rec);
    const job2 = await db.job.create({ data: { organizationId: org, title: 'Loader', type: 'CONTRACT' } });
    const ana2 = (await db.application.create({ data: { organizationId: org, candidateId: anaCand, jobId: job2.id, stage: 'PLACED' } })).id;
    const r = await plan({ dryRun: true, applicationIds: [ana2], dates: ['2026-10-16'], start: '06:00', end: '18:00' });
    expect((await r.json()).items[0].blocked).toBeNull();
    const both = await plan({ dryRun: true, applicationIds: [ana, ana2], dates: ['2026-10-17'] });
    expect((await both.json()).items[1].blocked).toMatch(/in this schedule/);
  });

  it('is for recruiters and up, and validates input', async () => {
    as(viewer);
    expect((await plan({ applicationIds: [ana], dates: WEEK })).status).toBe(403);
    as(rec);
    const r = await plan({ applicationIds: [], dates: WEEK });
    expect([r.status, (await r.json()).error]).toEqual([400, 'Choose at least one worker.']);
  });
});

describe('edit many shifts', () => {
  const ids = async (app: string) => (await db.shift.findMany({ where: { applicationId: app, cancelled: false }, orderBy: { date: 'asc' } })).map((s) => s.id);

  it('changes times for a selection and resets confirmations', async () => {
    as(rec);
    const sel = await ids(ana);
    await db.shift.updateMany({ where: { id: sel[0] }, data: { notified: true, notifiedAt: new Date(), response: 'CONFIRMED' } });
    const r = await PATCH(req('PATCH', { ids: sel, change: { start: '08:00', end: '16:30' } }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ updated: 4, needsNotice: 1 });
    const rows = await db.shift.findMany({ where: { id: { in: sel } } });
    expect(rows.every((s) => s.start === '08:00' && s.end === '16:30' && !s.notified && s.response === 'PENDING')).toBe(true);
  });

  it('moves shifts by days, and refuses a move onto a shift the worker already has', async () => {
    as(rec);
    const sel = await ids(ben);
    const clash = await PATCH(req('PATCH', { ids: [sel[0]], change: { moveDays: 1 } }));
    expect(clash.status).toBe(409);
    const r = await PATCH(req('PATCH', { ids: sel, change: { moveDays: 1 } }));
    expect(r.status).toBe(200);
    const dates = (await db.shift.findMany({ where: { id: { in: sel } }, orderBy: { date: 'asc' } })).map((s) => s.date.toISOString().slice(0, 10));
    expect(dates).toEqual(['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
  });

  it('hands shifts to another worker: unsent ones move, sent ones become a cancellation plus a new draft', async () => {
    as(rec);
    const [sent, unsent] = (await ids(ben)).slice(2);
    await db.shift.updateMany({ where: { id: sent }, data: { notified: true, notifiedAt: new Date() } });
    const blocked = await PATCH(req('PATCH', { ids: [sent], change: { applicationId: dee } }));
    expect([blocked.status, (await blocked.json()).error]).toEqual([409, 'Dee is on Acme Warehouse’s do-not-return list.']);
    const r = await PATCH(req('PATCH', { ids: [sent, unsent], change: { applicationId: cal } }));
    expect(r.status).toBe(200);
    expect((await db.shift.findFirstOrThrow({ where: { id: sent } })).cancelled).toBe(true);
    expect((await db.shift.findFirstOrThrow({ where: { id: unsent } })).applicationId).toBe(cal);
    expect(await db.shift.count({ where: { applicationId: cal, cancelled: false } })).toBe(3);
  });

  it('removes a selection: unsent deleted, sent cancelled', async () => {
    as(rec);
    const sel = await ids(ana);
    const r = await DELETE(req('DELETE', { ids: sel }));
    expect(await r.json()).toEqual({ deleted: 3, cancelled: 1 });
    expect(await db.shift.count({ where: { applicationId: ana } })).toBe(1);
  });

  it('never touches another company’s shifts', async () => {
    const theirs = await db.shift.create({ data: { organizationId: other, applicationId: otherApp, date: new Date('2026-10-12T00:00:00Z'), start: '07:00', end: '15:00' } });
    as(rec);
    expect((await PATCH(req('PATCH', { ids: [theirs.id], change: { start: '09:00' } }))).status).toBe(404);
    expect(await (await DELETE(req('DELETE', { ids: [theirs.id] }))).json()).toEqual({ deleted: 0, cancelled: 0 });
    expect(await db.shift.count({ where: { id: theirs.id, start: '07:00' } })).toBe(1);
  });
});
