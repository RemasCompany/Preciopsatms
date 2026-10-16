import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: (typeof mail.sent)[number]) => { mail.sent.push(o); return { id: `em_${mail.sent.length}` }; }) }));

import { db } from '@/lib/db';
import { tenantDb } from '@/lib/tenant';
import { addMonthsYmd, nextDue, nextStage, runReviewReminders, upcoming } from '@/lib/review-schedule';
import { saveManagerReview } from '@/lib/reviews';
import { PATCH as SCHEDULE } from '@/app/api/reviews/schedule/route';

describe('review due dates', () => {
  it('keeps month-end dates inside the month', () => {
    expect([addMonthsYmd('2026-01-31', 1), addMonthsYmd('2028-01-31', 1), addMonthsYmd('2026-08-31', 6)]).toEqual(['2026-02-28', '2028-02-29', '2027-02-28']);
  });
  it('falls on work anniversaries, every year or every six months', () => {
    const base = { startDate: '2023-03-15', basis: 'HIRE_DATE' as const, month: 1, after: '2026-10-16' };
    expect(nextDue({ ...base, frequency: 'ANNUAL' })).toBe('2027-03-15');
    expect(nextDue({ ...base, frequency: 'SEMIANNUAL' })).toBe('2027-03-15');
    expect(nextDue({ ...base, frequency: 'SEMIANNUAL', after: '2026-08-01' })).toBe('2026-09-15');
    expect(nextDue({ ...base, startDate: '2026-09-01', frequency: 'SEMIANNUAL' })).toBe('2027-03-01'); // first one six months in
    expect(nextDue({ ...base, frequency: 'NONE' })).toBeNull();
  });
  it('or at the end of fixed months, skipping brand-new hires', () => {
    const base = { startDate: '2020-05-01', basis: 'CALENDAR' as const, month: 1, after: '2026-10-16' };
    expect(nextDue({ ...base, frequency: 'ANNUAL' })).toBe('2027-01-31');
    expect(nextDue({ ...base, frequency: 'SEMIANNUAL', after: '2026-06-01' })).toBe('2026-07-31');
    expect(nextDue({ ...base, frequency: 'SEMIANNUAL', month: 3 })).toBe('2027-03-31'); // March and September
    expect(nextDue({ ...base, frequency: 'ANNUAL', startDate: '2026-12-01' })).toBe('2028-01-31'); // 61 days in: next year
  });
  it('steps through reminders once each, catching up after a missed day', () => {
    expect([nextStage(30, -1), nextStage(14, 0), nextStage(10, 1), nextStage(5, -1), nextStage(0, 3), nextStage(-8, 4), nextStage(-40, 8)]).toEqual([0, 1, null, 2, 4, 5, null]);
  });
});

const RUN = `rsch${Date.now()}`;
let org: string, owner: string, mgrUser: string, mgr: string, ana: string, ben: string, cy: string, dee: string, noAcct: string;
const NOW = new Date('2026-10-16T15:00:00Z'); // today in Chicago: 2026-10-16
const later = (days: number) => new Date(NOW.getTime() + days * 864e5);

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Northwind Foods', slug: `nw-${RUN}`, plan: 'growth', subscriptionStatus: 'active', kind: 'EMPLOYER', timezone: 'America/Chicago' } })).id;
  const u = (n: string, email = `${n}@${RUN}.test`) => db.user.create({ data: { email, name: n, passwordHash: 'x' } }).then((x) => x.id);
  owner = await u('olga'); mgrUser = await u('Maya Manager', `maya@${RUN}.test`);
  await db.membership.createMany({ data: [{ userId: owner, organizationId: org, role: 'OWNER' }, { userId: mgrUser, organizationId: org, role: 'RECRUITER' }] });
  const emp = async (name: string, o: { start: string; managerId?: string; email?: string; workEmail?: string; freq?: string; optOut?: boolean; title?: string }) => {
    const c = await db.candidate.create({ data: { organizationId: org, name, email: o.email ?? null, emailOptOut: !!o.optOut } });
    return (await db.employee.create({ data: { organizationId: org, candidateId: c.id, title: o.title ?? 'Picker', startDate: new Date(`${o.start}T00:00:00Z`), payRate: 20, managerId: o.managerId ?? null, workEmail: o.workEmail ?? null, reviewFrequency: o.freq ?? null } })).id;
  };
  mgr = await emp('Maya Manager', { start: '2019-02-01', workEmail: `maya@${RUN}.test`, title: 'Shift lead' }); // her own anniversary is in February
  ana = await emp('Ana Ruiz', { start: '2024-11-05', managerId: mgr }); // annual: due 2026-11-05, 20 days out
  ben = await emp('Ben Ode', { start: '2025-05-20', managerId: mgr, freq: 'SEMIANNUAL' }); // semi-annual: due 2026-11-20, 35 days out
  cy = await emp('Cy Lone', { start: '2023-11-01' }); // no manager: due 2026-11-01
  noAcct = await emp('Nia Lead', { start: '2018-06-01', email: `nia@${RUN}.test`, title: 'Supervisor' }); // a manager with no Preciops account
  dee = await emp('Dee Park', { start: '2021-10-28', managerId: noAcct }); // due 2026-10-28
  await emp('Old Hand', { start: '2010-10-20', managerId: mgr, freq: 'NONE' });
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('scheduled reviews and manager reminders', () => {
  it('only admins set the schedule; turning it on adds the reviews within the lead time', async () => {
    session.current = { user: { id: mgrUser, orgId: org } };
    expect((await SCHEDULE(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ reviewScheduleOn: true }) }))).status).toBe(403);
    session.current = { user: { id: owner, orgId: org } };
    const bad = await SCHEDULE(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ reviewLeadDays: 200 }) }));
    expect([bad.status, (await bad.json()).error]).toEqual([400, 'Add reviews at most 90 days ahead.']);
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const r = await SCHEDULE(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ reviewScheduleOn: true, reviewFrequency: 'ANNUAL', reviewBasis: 'HIRE_DATE', reviewLeadDays: 30 }) }));
    vi.useRealTimers();
    expect(await r.json()).toEqual({ ok: true, added: 3 }); // Ana, Cy, Dee — Ben's is 35 days out
    const rows = await db.review.findMany({ where: { organizationId: org }, include: { cycle: true }, orderBy: { dueDate: 'asc' } });
    expect(rows.map((x) => [x.dueDate!.toISOString().slice(0, 10), x.cycle.name])).toEqual([
      ['2026-10-28', 'Annual reviews · October 2026'], ['2026-11-01', 'Annual reviews · November 2026'], ['2026-11-05', 'Annual reviews · November 2026'],
    ]);
    const o = await db.organization.findUniqueOrThrow({ where: { id: org } });
    expect((await upcoming(tenantDb(org), o, '2026-10-16', 60)).map((x) => [x.name, x.frequency, x.due, !!x.reviewId])).toEqual([
      ['Dee Park', 'ANNUAL', '2026-10-28', true], ['Cy Lone', 'ANNUAL', '2026-11-01', true], ['Ana Ruiz', 'ANNUAL', '2026-11-05', true], ['Ben Ode', 'SEMIANNUAL', '2026-11-20', false],
    ]);
  });

  it('emails each manager once about their team, with a task; HR gets the ones nobody else can do', async () => {
    mail.sent = [];
    const r = await runReviewReminders(NOW, 'https://app.test');
    expect(r).toMatchObject({ added: 0, emails: 3 });
    const by = Object.fromEntries(mail.sent.map((m) => [m.to, m]));
    expect(by[`maya@${RUN}.test`].subject).toBe('1 performance review coming due');
    expect(by[`maya@${RUN}.test`].text).toContain('- Ana Ruiz, Picker: annual review due in 20 days (Nov 5, 2026)');
    expect(by[`maya@${RUN}.test`].text).toContain('https://app.test/app/reviews');
    expect(by[`nia@${RUN}.test`].text).toContain('- Dee Park, Picker: annual review due in 12 days');
    expect(by[`nia@${RUN}.test`].text).toContain('If you don’t have an account under this email address, ask HR to set one up');
    const hr = by[`olga@${RUN}.test`];
    expect(hr.text).toContain('- Dee Park, Picker: annual review due in 12 days (Oct 28, 2026) — manager Nia Lead has no email on file or no Preciops account under it');
    expect(hr.text).toContain('- Cy Lone, Picker: annual review due in 16 days (Nov 1, 2026) — no manager set');
    const task = await db.task.findFirstOrThrow({ where: { organizationId: org, assigneeId: mgrUser } });
    expect([task.title, task.dueAt!.toISOString().slice(0, 10), task.priority]).toEqual(['Write Ana Ruiz’s annual review', '2026-11-05', 'Normal']);
    expect(await db.message.count({ where: { organizationId: org, channel: 'email' } })).toBe(3);
  });

  it('doesn’t repeat itself; the next reminder comes at the next stage', async () => {
    mail.sent = [];
    await runReviewReminders(NOW);
    await runReviewReminders(later(1));
    expect(mail.sent).toEqual([]);
    await runReviewReminders(later(6)); // Ana 14 days out, Dee 6, Cy 10; Ben now added (29 days out)
    const maya = mail.sent.find((m) => m.to === `maya@${RUN}.test`)!;
    expect(maya.subject).toBe('2 performance reviews coming due');
    expect(maya.text).toMatch(/Ana Ruiz, Picker: annual review due in 14 days[\s\S]*Ben Ode, Picker: semi-annual review due in 29 days/);
    expect((await db.task.findFirstOrThrow({ where: { assigneeId: mgrUser, title: { contains: 'Ana' } } })).priority).toBe('Normal');
  });

  it('keeps reminding weekly while overdue, and stops once the review is written', async () => {
    mail.sent = [];
    await runReviewReminders(later(21)); // Ana 1 day overdue
    expect(mail.sent.find((m) => m.to === `maya@${RUN}.test`)!.subject).toBe('2 performance reviews need attention (1 overdue)');
    const anaReview = (await db.review.findFirstOrThrow({ where: { employeeId: ana } })).id;
    const o = await db.organization.findUniqueOrThrow({ where: { id: org } });
    const user = await db.user.findUniqueOrThrow({ where: { id: mgrUser } });
    await saveManagerReview({ tdb: tenantDb(org), org: o, user, role: 'RECRUITER' }, anaReview, { answers: { q1: { rating: 4 }, q2: { rating: 4 }, q3: { rating: 4 }, q4: { rating: 5 }, q5: { text: 'Great' }, q6: { text: 'More cross-training' } }, rating: 4, submit: true });
    expect((await db.task.findFirstOrThrow({ where: { assigneeId: mgrUser, title: { contains: 'Ana' } } })).done).toBe(true);
    mail.sent = [];
    await runReviewReminders(later(28));
    const maya = mail.sent.find((m) => m.to === `maya@${RUN}.test`);
    expect(maya?.text ?? '').not.toContain('Ana Ruiz');
  });

  it('doesn’t add a second review for someone already in a review HR started', async () => {
    const o = await db.organization.findUniqueOrThrow({ where: { id: org } });
    const c = await db.reviewCycle.create({ data: { organizationId: org, name: '2027 midyear', periodStart: new Date('2027-01-01'), periodEnd: new Date('2027-06-30'), dueDate: new Date('2027-07-15'), questions: [] } });
    const late = await db.candidate.create({ data: { organizationId: org, name: 'Lia Busy' } });
    const lia = (await db.employee.create({ data: { organizationId: org, candidateId: late.id, title: 'Picker', startDate: new Date('2025-12-01T00:00:00Z'), payRate: 20, managerId: mgr } })).id;
    await db.review.create({ data: { organizationId: org, cycleId: c.id, employeeId: lia } });
    const u = (await upcoming(tenantDb(org), o, '2026-11-10', 60)).find((x) => x.employeeId === lia)!;
    expect([u.due, u.inCycle, u.reviewId]).toEqual(['2026-12-01', '2027 midyear', null]);
    await runReviewReminders(new Date('2026-11-10T15:00:00Z'));
    expect(await db.review.count({ where: { employeeId: lia } })).toBe(1);
  });

  it('honors a manager’s email opt-out (HR is told instead)', async () => {
    const nia = await db.employee.findUniqueOrThrow({ where: { id: noAcct } });
    await db.candidate.update({ where: { id: nia.candidateId }, data: { emailOptOut: true } });
    mail.sent = [];
    await runReviewReminders(later(35)); // Dee 3 weeks overdue
    expect(mail.sent.some((m) => m.to === `nia@${RUN}.test`)).toBe(false);
    expect(mail.sent.find((m) => m.to.startsWith('olga'))!.text).toContain('Dee Park');
    expect(dee && cy && ben).toBeTruthy();
  });
  it('a review HR ran by hand shortly before counts as this one', async () => {
    const o = await db.organization.findUniqueOrThrow({ where: { id: org } });
    const c = await db.reviewCycle.create({ data: { organizationId: org, name: 'Fall check-in', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-12-31'), dueDate: new Date('2026-11-30'), questions: [] } });
    const p = await db.candidate.create({ data: { organizationId: org, name: 'Rae Done' } });
    const rae = (await db.employee.create({ data: { organizationId: org, candidateId: p.id, title: 'Picker', startDate: new Date('2022-12-20T00:00:00Z'), payRate: 20, managerId: mgr } })).id;
    await db.review.create({ data: { organizationId: org, cycleId: c.id, employeeId: rae, managerSubmittedAt: new Date('2026-11-08T12:00:00Z') } });
    const u = (await upcoming(tenantDb(o.id), o, '2026-11-25', 60)).find((x) => x.employeeId === rae)!;
    expect([u.due, u.inCycle]).toEqual(['2026-12-20', 'Fall check-in (written Nov 8, 2026)']);
    await runReviewReminders(new Date('2026-11-25T15:00:00Z'));
    expect(await db.review.count({ where: { employeeId: rae } })).toBe(1);
  });

});
