import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { db } from '@/lib/db';
import { newToken, sha256 } from '@/lib/tokens';
import { checkFence, distanceM, howFar, parseCoords } from '@/lib/geo';
import { POST as PUNCH } from '@/app/api/public/clock/[token]/route';
import { PATCH as SITE } from '@/app/api/timeclock/sites/route';
import { PATCH as SETTINGS } from '@/app/api/timeclock/settings/route';

const SITE_AT = { lat: 28.538336, lng: -81.379234 }; // downtown Orlando
const NEAR = { lat: 28.5392, lng: -81.3792 };         // ~100 m north
const FAR = { lat: 28.5536, lng: -81.3792 };          // ~1.7 km north

describe('geofence math', () => {
  it('measures distance and allows for phone accuracy', () => {
    expect(distanceM(SITE_AT, NEAR)).toBeGreaterThan(80);
    expect(distanceM(SITE_AT, NEAR)).toBeLessThan(120);
    const site = { ...SITE_AT, radiusM: 300 };
    expect(checkFence(site, NEAR)).toMatchObject({ outside: false, reason: 'inside' });
    expect(checkFence(site, FAR)).toMatchObject({ outside: true, reason: 'outside' });
    expect(checkFence(site, { ...FAR, accuracy: 1500 })).toMatchObject({ outside: true }); // accuracy credit is capped at 500 m
    expect(checkFence({ ...site, radiusM: 1500 }, { ...FAR, accuracy: 300 })).toMatchObject({ outside: false });
    expect(checkFence(site, null)).toMatchObject({ outside: true, reason: 'no-location' });
    expect(checkFence(null, FAR)).toMatchObject({ outside: false, reason: 'no-site' });
    expect([howFar(240), howFar(1700)]).toEqual(['240 m', '1.1 miles']);
  });
  it('reads coordinates and map links', () => {
    expect(parseCoords('28.538336, -81.379234')).toEqual(SITE_AT);
    expect(parseCoords('https://www.google.com/maps/place/X/@28.5383,-81.3792,17z')).toEqual({ lat: 28.5383, lng: -81.3792 });
    expect(parseCoords('Orlando, FL')).toBeNull();
    expect(parseCoords('99, 10')).toBeNull();
  });
});

const RUN = `gf${Date.now()}`;
let org: string, admin: string, job: string, token: string;
const as = (u: string) => { session.current = { user: { id: u, orgId: org } }; };
const req = (method: string, body?: object) => new Request('http://x', { method, headers: { 'x-forwarded-for': '8.8.8.8' }, body: body ? JSON.stringify(body) : undefined });
const punch = (action: string, geo?: object) => PUNCH(req('POST', { action, geo }), { params: { token } });

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Geo Staffing', slug: `g-${RUN}`, plan: 'growth', subscriptionStatus: 'active', timezone: 'America/New_York' } })).id;
  admin = (await db.user.create({ data: { email: `a@${RUN}.test`, name: 'Admin', passwordHash: 'x' } })).id;
  await db.membership.create({ data: { userId: admin, organizationId: org, role: 'ADMIN' } });
  job = (await db.job.create({ data: { organizationId: org, title: 'Dock Worker', type: 'TEMP' } })).id;
  const cand = await db.candidate.create({ data: { organizationId: org, name: 'Gia Geo' } });
  await db.application.create({ data: { organizationId: org, candidateId: cand.id, jobId: job, stage: 'PLACED' } });
  token = newToken();
  await db.workerLink.create({ data: { organizationId: org, candidateId: cand.id, tokenHash: sha256(token), kind: 'timeclock', expiresAt: new Date(Date.now() + 864e5) } });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});
const lastEntry = () => db.timeEntry.findFirst({ where: { organizationId: org }, orderBy: { clockIn: 'desc' } });

describe('time clock geofence', () => {
  it('sets a job site from coordinates', async () => {
    as(admin);
    expect((await (await SITE(req('PATCH', { jobId: job, coords: 'somewhere', radius: 300 }))).json()).error).toBe('Paste coordinates like 28.5383, -81.3792, or a Google Maps link with a pin.');
    expect((await (await SITE(req('PATCH', { jobId: job, coords: '28.5, -81.3', radius: 10 }))).json()).error).toBe('Use at least 50 m — phones aren’t more precise than that.');
    expect((await SITE(req('PATCH', { jobId: job, coords: '28.538336, -81.379234', radius: 300 }))).status).toBe(200);
    expect(await db.job.findUnique({ where: { id: job } })).toMatchObject({ siteLat: 28.538336, siteLng: -81.379234, geofenceMeters: 300 });
  });

  it('flags off-site punches by default', async () => {
    expect((await punch('in', FAR)).status).toBe(200);
    expect(await lastEntry()).toMatchObject({ offSite: true });
    expect((await lastEntry())!.inDistanceM).toBeGreaterThan(1500);
    expect((await punch('out', NEAR)).status).toBe(200);
    expect(await db.activity.count({ where: { organizationId: org, text: { contains: 'from the site' } } })).toBe(1);
    expect((await punch('in', NEAR)).status).toBe(200);
    expect(await lastEntry()).toMatchObject({ offSite: false });
    await punch('out', NEAR);
  });

  it('blocks clock-in away from the site in block mode, but never clock-out', async () => {
    as(admin);
    expect((await SETTINGS(req('PATCH', { geofenceMode: 'block' }))).status).toBe(200);
    const far = await punch('in', FAR);
    expect([far.status, (await far.json()).error]).toEqual([403, 'You’re about 1.1 miles from the job site. Clock in when you get there, or contact your recruiter.']);
    expect((await (await punch('in')).json()).error).toBe('Allow location for this page to clock in — your company checks that you’re at the job site.');
    expect((await punch('in', NEAR)).status).toBe(200);
    expect((await punch('out', FAR)).status).toBe(200); // stopping the clock is always allowed…
    expect(await lastEntry()).toMatchObject({ offSite: true }); // …and flagged
    expect((await SETTINGS(req('PATCH', { geofenceMode: 'off' }))).status).toBe(200);
    expect((await punch('in', FAR)).status).toBe(200);
    expect(await lastEntry()).toMatchObject({ offSite: false, inDistanceM: null });
  });
});
