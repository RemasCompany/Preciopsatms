import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const out = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; text: string }[], sms: [] as { to: string; body: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => null) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: (typeof out.emails)[number]) => { out.emails.push(o); return { id: `em_${out.emails.length}` }; }) }));
vi.mock('@/lib/sms', async (orig) => ({ ...(await orig<typeof import('@/lib/sms')>()), sendSms: vi.fn(async (to: string, body: string) => { out.sms.push({ to, body }); return { id: `sm_${out.sms.length}` }; }) }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { ackStage, employeeMessage, selfStage } from '@/lib/review-nudges';
import { runReviewReminders } from '@/lib/review-schedule';
import { saveManagerReview, saveSelfReview, shareReview } from '@/lib/reviews';
import { resolveWorkerLink } from '@/lib/schedule-server';
import { employeeAction, employeeHub } from '@/lib/self-service';

describe('employee reminder stages', () => {
  it('self reviews count down to a week before the due date, then a few late ones', () => {
    expect([selfStage(20, -1), selfStage(14, -1), selfStage(9, 0), selfStage(6, 0), selfStage(0, 1), selfStage(-4, 4), selfStage(-30, 6)]).toEqual([null, 0, null, 1, 4, 5, null]);
  });
  it('acknowledgements are asked for when shared, then after 3, 7, 14 and 21 days', () => {
    expect([ackStage(0, -1), ackStage(2, 0), ackStage(3, 0), ackStage(10, 1), ackStage(40, 4)]).toEqual([0, null, 1, 2, null]);
  });
  it('writes one plain message per person', () => {
    const m = employeeMessage('Northwind', 'Ana', [{ reviewId: 'a', kind: 'self', cycle: '2026 review', wanted: '2026-11-08', days: 14, stage: 0 }, { reviewId: 'b', kind: 'ack', cycle: 'Midyear', wanted: '2026-10-20', days: 3, stage: 1 }], 'https://x/shifts/t');
    expect(m.subject).toBe('Your performance reviews need you');
    expect(m.text).toContain('- Self review for 2026 review: please finish it by Nov 8 (14 days)');
    expect(m.text).toContain('- Midyear: your manager shared your review 3 days ago. Please read it and acknowledge it');
    expect(m.text).toContain('https://x/shifts/t');
    expect(employeeMessage('N', 'A', [{ reviewId: 'b', kind: 'ack', cycle: 'M', wanted: '', days: 0, stage: 0 }], 'l').subject).toBe('Your performance review is ready to read');
  });
});

const RUN = `rnud${Date.now()}`;
let org: string, owner: string, ana: string, ben: string, cy: string, cycle: string, anaReview: string, benReview: string;
const at = (d: string) => new Date(`${d}T15:00:00Z`); // mid-morning in Chicago

beforeAll(async () => {
  process.env.APP_URL = 'https://app.test';
  org = (await db.organization.create({ data: { name: 'Northwind Foods', shortName: 'Northwind', slug: `nwn-${RUN}`, plan: 'growth', subscriptionStatus: 'active', kind: 'EMPLOYER', timezone: 'America/Chicago', reviewScheduleOn: true, reviewFrequency: 'NONE' } })).id;
  owner = (await db.user.create({ data: { email: `olga@${RUN}.test`, name: 'Olga', passwordHash: 'x' } })).id;
  await db.membership.create({ data: { userId: owner, organizationId: org, role: 'OWNER' } });
  const emp = async (name: string, o: { email?: string; phone?: string; emailOptOut?: boolean }) => {
    const c = await db.candidate.create({ data: { organizationId: org, name, email: o.email ?? null, phone: o.phone ?? null, emailOptOut: !!o.emailOptOut } });
    return (await db.employee.create({ data: { organizationId: org, candidateId: c.id, title: 'Picker', startDate: new Date('2024-01-08T00:00:00Z'), payRate: 20 } })).id;
  };
  ana = await emp('Ana Ruiz', { email: 'ana@nw.test' });
  ben = await emp('Ben Ode', { phone: '(312) 555-0142' });
  cy = await emp('Cy Lone', { email: 'cy@nw.test', emailOptOut: true });
  cycle = (await db.reviewCycle.create({ data: { organizationId: org, name: '2026 annual review', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-12-31'), dueDate: new Date('2026-11-15'), questions: [{ id: 'q1', text: 'Quality of work', kind: 'rating' }] } })).id;
  for (const e of [ana, ben, cy]) await db.review.create({ data: { organizationId: org, cycleId: cycle, employeeId: e } });
  anaReview = (await db.review.findFirstOrThrow({ where: { employeeId: ana } })).id;
  benReview = (await db.review.findFirstOrThrow({ where: { employeeId: ben } })).id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('reminding employees', () => {
  it('reminds each employee once per stage — email, or a text when there’s no email — with a link to their page', async () => {
    out.emails = []; out.sms = [];
    const r = await runReviewReminders(at('2026-10-25'), 'https://app.test'); // self reviews wanted Nov 8: 14 days
    expect(r.employees).toBe(2);
    const email = out.emails.find((m) => m.to === 'ana@nw.test')!;
    expect(email.subject).toBe('Please complete your self review');
    expect(email.text).toContain('- Self review for 2026 annual review: please finish it by Nov 8 (14 days)');
    expect(out.sms.map((s) => s.to)).toEqual(['(312) 555-0142']);
    expect(out.sms[0].body).toMatch(/^Northwind: hi Ben, please complete your self review by Nov 8: https:\/\/app\.test\/shifts\/[\w-]+$/);
    expect(out.emails.some((m) => m.to === 'cy@nw.test')).toBe(false); // opted out, no phone
    // The link opens Ana's own page, which shows the same deadline.
    const token = email.text.match(/\/shifts\/([\w-]+)/)![1];
    const link = (await resolveWorkerLink(token))!;
    expect(link.kind).toBe('review');
    expect((await employeeHub(link))!.reviews[0]).toMatchObject({ id: anaReview, canSelf: true, dueDate: '2026-11-08' });
    out.emails = []; out.sms = [];
    await runReviewReminders(at('2026-10-26'));
    expect([out.emails.length, out.sms.length]).toEqual([0, 0]);
  });

  it('stops once the self review is in; the next stage replaces the old link', async () => {
    const before = await db.workerLink.findFirstOrThrow({ where: { candidate: { name: 'Ben Ode' }, kind: 'review', revokedAt: null } });
    await saveSelfReview(tenantDb(org), ana, anaReview, { answers: { q1: { rating: 4 } }, submit: true });
    out.emails = []; out.sms = [];
    await runReviewReminders(at('2026-11-02')); // 6 days left
    expect(out.emails.filter((m) => m.to === 'ana@nw.test')).toEqual([]);
    expect(out.sms).toHaveLength(1);
    expect((await db.workerLink.findUniqueOrThrow({ where: { id: before.id } })).revokedAt).not.toBeNull();
  });

  it('tells the employee when a review is shared, then asks them to acknowledge it', async () => {
    const o = await db.organization.findUniqueOrThrow({ where: { id: org } });
    const user = await db.user.findUniqueOrThrow({ where: { id: owner } });
    const ctx = { tdb: tenantDb(org), org: o, user, role: 'OWNER' as const };
    await saveManagerReview(ctx, anaReview, { answers: { q1: { rating: 4 } }, rating: 4, summary: 'Solid year', submit: true });
    out.emails = [];
    vi.useFakeTimers({ toFake: ['Date'], now: at('2026-11-04') });
    expect(await shareReview(ctx, anaReview)).toEqual({ ok: true, notified: true });
    vi.useRealTimers();
    expect(out.emails.map((m) => [m.to, m.subject])).toEqual([['ana@nw.test', 'Your performance review is ready to read']]);
    out.emails = [];
    await runReviewReminders(at('2026-11-05'));
    expect(out.emails.filter((m) => m.to === 'ana@nw.test')).toEqual([]); // day 0 already sent
    await runReviewReminders(at('2026-11-07'));
    expect(out.emails.find((m) => m.to === 'ana@nw.test')!.subject).toBe('Please acknowledge your review'.replace('your review', 'your performance review'));
  });

  it('employees acknowledge and accept — or note that they disagree, with a comment — and the reminders stop', async () => {
    const token = out.emails.find((m) => m.to === 'ana@nw.test')!.text.match(/\/shifts\/([\w-]+)/)![1];
    const link = (await resolveWorkerLink(token))!;
    await expect(employeeAction(link, { action: 'acknowledge', reviewId: anaReview, agree: false, comment: '' })).rejects.toThrow('Say what you disagree with');
    expect(await employeeAction(link, { action: 'acknowledge', reviewId: anaReview, agree: false, comment: 'The rating misses the night-shift cover I did.' }))
      .toEqual({ message: 'Thanks — your manager and HR will see your comments and follow up.' });
    expect(await db.review.findUniqueOrThrow({ where: { id: anaReview } })).toMatchObject({ employeeAgrees: false, employeeComment: 'The rating misses the night-shift cover I did.' });
    out.emails = [];
    await runReviewReminders(at('2026-11-20'));
    expect(out.emails.filter((m) => m.to === 'ana@nw.test')).toEqual([]);
    expect(benReview && cy).toBeTruthy();
  });

  it('can be turned off', async () => {
    await db.organization.update({ where: { id: org }, data: { reviewRemindEmployees: false } });
    out.sms = [];
    await runReviewReminders(at('2026-11-12'));
    expect(out.sms).toEqual([]);
  });
});
