import { describe, expect, it } from 'vitest';
import { dailyOtIssue, fairWorkweek, mealBreakIssue, noticeIssue, parsePlace, payTransparencyIssue, shiftRuleWarnings } from '@/lib/state-rules';

describe('state rules', () => {
  it('reads locations', () => {
    expect(parsePlace('Brooklyn, NY 11201')).toEqual({ city: 'Brooklyn', state: 'NY' });
    expect(parsePlace('orlando, fl')).toEqual({ city: 'orlando', state: 'FL' });
    expect(parsePlace('Remote')).toEqual({ city: null, state: null });
  });
  it('pay transparency', () => {
    const job = { location: 'Denver, CO', publish: true, status: 'OPEN', payRate: null };
    expect(payTransparencyIssue(job, true)).toBe('Colorado requires the pay rate or range in job postings — add a pay rate.');
    expect(payTransparencyIssue({ ...job, payRate: 22 }, false)).toMatch(/turn on “Show pay rates”/);
    expect(payTransparencyIssue({ ...job, payRate: 22 }, true)).toBeNull();
    expect(payTransparencyIssue({ ...job, location: 'Orlando, FL' }, true)).toBeNull();
    expect(payTransparencyIssue({ ...job, publish: false }, true)).toBeNull();
  });
  it('meal breaks, including California’s second meal', () => {
    expect(mealBreakIssue('CA', 6 * 60, 0)).toMatch(/^California: a 30-minute meal break is due after 5 hours — none recorded/);
    expect(mealBreakIssue('CA', 6 * 60, 30)).toBeNull();
    expect(mealBreakIssue('CA', 11 * 60, 30)).toMatch(/second meal break \(60 minutes total\) is due after 10 hours — only 30 min recorded/);
    expect(mealBreakIssue('IL', 8 * 60, 20)).toBeNull();
    expect(mealBreakIssue('IL', 7 * 60, 0)).toBeNull();
    expect(mealBreakIssue('FL', 12 * 60, 0)).toBeNull();
  });
  it('daily overtime', () => {
    expect(dailyOtIssue('CA', 10)).toBe('California: hours over 8 in a day are overtime. Adjust the timesheet’s overtime hours if this applies to you.');
    expect(dailyOtIssue('CA', 13)).toMatch(/over 12 are double time/);
    expect(dailyOtIssue('CO', 10)).toBeNull();
    expect(dailyOtIssue('TX', 14)).toBeNull();
  });
  it('predictive scheduling by city', () => {
    expect(fairWorkweek(parsePlace('Seattle, WA'))?.name).toBe('Seattle');
    expect(fairWorkweek(parsePlace('Spokane, WA'))).toBeNull();
    expect(fairWorkweek(parsePlace('Portland, OR'))?.name).toBe('Oregon');
    expect(fairWorkweek(parsePlace('Queens, NY'))?.name).toBe('New York City');
    expect(noticeIssue('Chicago, IL', '2026-10-05', '2026-09-30')).toMatch(/^Chicago predictive scheduling: .* this one is 5 days out/);
    expect(noticeIssue('Chicago, IL', '2026-10-20', '2026-09-30')).toBeNull();
    expect(shiftRuleWarnings({ location: 'San Francisco, CA' }, { date: '2026-10-01', hours: 9.5, breakMinutes: 0 }, '2026-09-30')).toHaveLength(3);
  });
});

import { afterAll, beforeAll, vi } from 'vitest';
const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
import { db } from '@/lib/db';
import { POST as SHIFT } from '@/app/api/shifts/route';

const RUN = `sr${Date.now()}`;
let org: string, app: string;
beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Seattle Staffing', slug: `s-${RUN}`, plan: 'growth', subscriptionStatus: 'active', timezone: 'America/Los_Angeles' } })).id;
  const u = await db.user.create({ data: { email: `r@${RUN}.test`, name: 'Rae', passwordHash: 'x' } });
  await db.membership.create({ data: { userId: u.id, organizationId: org, role: 'RECRUITER' } });
  const job = await db.job.create({ data: { organizationId: org, title: 'Barista', type: 'TEMP', location: 'Seattle, WA' } });
  const c = await db.candidate.create({ data: { organizationId: org, name: 'Bea' } });
  app = (await db.application.create({ data: { organizationId: org, candidateId: c.id, jobId: job.id, stage: 'PLACED' } })).id;
  session.current = { user: { id: u.id, orgId: org } };
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('state rules when scheduling', () => {
  it('warns about short notice and a missing meal break in Seattle', async () => {
    const soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    const r = await (await SHIFT(new Request('http://x', { method: 'POST', body: JSON.stringify({ applicationId: app, dates: [soon], start: '08:00', end: '15:00', breakMinutes: 0 }) }))).json();
    expect(r.warnings.some((w: string) => w.startsWith('Seattle predictive scheduling'))).toBe(true);
    expect(r.warnings.some((w: string) => w.startsWith('Washington: a 30-minute meal break'))).toBe(true);
    const later = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
    const r2 = await (await SHIFT(new Request('http://x', { method: 'POST', body: JSON.stringify({ applicationId: app, dates: [later], start: '08:00', end: '15:00', breakMinutes: 30 }) }))).json();
    expect(r2.warnings.filter((w: string) => /predictive|meal break/.test(w))).toEqual([]);
  });
});
