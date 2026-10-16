import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const out = vi.hoisted(() => ({ texts: [] as { to: string; body: string }[], emails: [] as { to: unknown; subject: string; text: string; attachments?: { filename: string; content: Buffer }[] }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: (typeof out.emails)[number]) => { out.emails.push(o); return { id: 'e' }; }) }));
vi.mock('@/lib/sms', async (orig) => ({ ...(await orig<typeof import('@/lib/sms')>()), sendSms: vi.fn(async (to: string, body: string) => { out.texts.push({ to, body }); return { id: 's' }; }) }));

import { db } from '@/lib/db';
import { POST as CREATE, GET as LIST } from '@/app/api/interviews/route';
import { GET as DETAIL, PATCH as CHANGE } from '@/app/api/interviews/[id]/route';
import { POST as SCORE } from '@/app/api/interviews/[id]/scorecard/route';
import { POST as PICK } from '@/app/api/public/interviews/[token]/route';
import { GET as PAGE } from '@/app/api/public/shifts/[token]/route';
import { GET as ENDING, POST as REDEPLOY } from '@/app/api/redeploy/route';
import { icsInvite, slotProblem, summarize } from '@/lib/interviews';
import { runInterviewReminders } from '@/lib/interviews-server';
import { runRedeployTasks } from '@/lib/redeploy';

const RUN = `ivr${Date.now()}`;
let org: string, ann: string, ben: string, viewer: string, cand: string, app: string, job: string;
const as = (u: string) => { session.current = { user: { id: u, orgId: org } }; };
const json = (body: unknown, method = 'POST') => new Request('http://x', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
// Local times (America/Chicago) a few days out, so they're always in the future.
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const tokenIn = (t: string) => t.match(/\/shifts\/([\w-]+)/)![1];

beforeAll(async () => {
  process.env.APP_URL = 'https://app.test';
  org = (await db.organization.create({ data: { name: 'Acme Staffing', shortName: 'Acme', slug: `iv-${RUN}`, plan: 'growth', subscriptionStatus: 'active', timezone: 'America/Chicago' } })).id;
  const user = async (email: string, name: string, role: 'ADMIN' | 'RECRUITER' | 'VIEWER') => { const u = await db.user.create({ data: { email: `${email}@${RUN}.test`, name, passwordHash: 'x' } }); await db.membership.create({ data: { userId: u.id, organizationId: org, role } }); return u.id; };
  ann = await user('ann', 'Ann Lead', 'RECRUITER'); ben = await user('ben', 'Ben Super', 'RECRUITER'); viewer = await user('vic', 'Vic Viewer', 'ADMIN');
  cand = (await db.candidate.create({ data: { organizationId: org, name: 'Maria Lopez', email: 'maria@x.test', phone: '(305) 555-0100', skills: ['Forklift', 'RF scanner'] } })).id;
  job = (await db.job.create({ data: { organizationId: org, title: 'Forklift Operator', skills: ['Forklift'], type: 'TEMP' } })).id;
  app = (await db.application.create({ data: { organizationId: org, candidateId: cand, jobId: job, stage: 'SUBMITTED', maxStage: 'SUBMITTED' } })).id;
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('interview rules', () => {
  it('checks offered times', () => {
    const t = (h: number) => new Date(Date.now() + h * 3600e3);
    expect(slotProblem([], 30)).toBe('Offer at least one time.');
    expect(slotProblem([t(0.2)], 30)).toBe('Every time needs to be at least 30 minutes from now.');
    expect(slotProblem([t(24), t(24.25)], 30)).toBe('Two of the times overlap. Space them at least one interview apart.');
    expect(slotProblem([t(24), t(25)], 30)).toBeNull();
  });
  it('summarizes scorecards and calls out a split decision', () => {
    const s = summarize([{ ratings: { Communication: 4, Reliability: 3 }, recommendation: 'STRONG_YES' }, { ratings: { Communication: 2 }, recommendation: 'NO' }]);
    expect(s.competencies).toEqual([{ name: 'Communication', average: 3, ratings: 2 }, { name: 'Reliability', average: 3, ratings: 1 }]);
    expect(s.verdict).toBe('Mixed');
    expect(summarize([{ ratings: {}, recommendation: 'YES' }]).verdict).toBe('Yes');
  });
  it('writes calendar invites calendar apps accept', () => {
    const ics = icsInvite({ uid: 'x@preciops', start: new Date('2026-10-20T19:00:00Z'), durationMin: 45, summary: 'Video interview, Forklift; Night', description: 'Line 1\nLine 2', location: 'https://meet.example/abc', organizer: { name: 'Acme', email: 'jobs@acme.test' }, attendees: [{ name: 'Maria', email: 'maria@x.test' }], sequence: 2, now: new Date('2026-10-16T00:00:00Z') });
    expect(ics).toContain('DTSTART:20261020T190000Z\r\nDTEND:20261020T194500Z');
    expect(ics).toContain('SUMMARY:Video interview\\, Forklift\\; Night');
    expect(ics).toContain('DESCRIPTION:Line 1\\nLine 2');
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
});

describe('scheduling an interview', () => {
  let id: string, token: string, picked: string;
  it('offers times by email; the application moves to Interview', async () => {
    as(ann);
    const res = await CREATE(json({ applicationId: app, kind: 'VIDEO', durationMin: 30, location: 'https://meet.example/abc', interviewerIds: [ann, ben], slots: [`${day(3)}T10:00`, `${day(3)}T14:30`, `${day(4)}T09:00`], channels: ['email'] }));
    expect(res.status).toBe(201);
    const r = await res.json();
    expect(r).toMatchObject({ status: 'PROPOSED', sent: ['email'] });
    id = r.id;
    expect((await db.application.findFirstOrThrow({ where: { id: app } })).stage).toBe('INTERVIEW');
    const mail = out.emails.at(-1)!;
    expect(mail.subject).toBe('Acme: pick a time for your interview');
    expect(mail.text).toMatch(/- \w{3}, \w{3} \d+, 10:00 AM CDT|CST/);
    token = tokenIn(mail.text);
    const page = await (await PAGE(new Request('http://x'), { params: { token } })).json();
    expect(page.interviews[0]).toMatchObject({ id, status: 'PROPOSED', location: null });
    expect(page.interviews[0].slots).toHaveLength(3);
    picked = page.interviews[0].slots[1].at;
  });

  it('won’t double-book an interviewer', async () => {
    const other = (await db.candidate.create({ data: { organizationId: org, name: 'Sam Reed', email: 'sam@x.test' } })).id;
    const app2 = (await db.application.create({ data: { organizationId: org, candidateId: other, jobId: job, stage: 'APPLIED', maxStage: 'APPLIED' } })).id;
    // Ben books Sam at the time Maria will pick.
    const local = new Date(picked).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 16).replace(' ', 'T');
    const res = await CREATE(json({ applicationId: app2, kind: 'PHONE', durationMin: 30, interviewerIds: [ben], slots: [local], channels: [] }));
    expect((await res.json()).status).toBe('SCHEDULED');
    const again = await CREATE(json({ applicationId: app2, kind: 'PHONE', durationMin: 30, interviewerIds: [ben], slots: [local], channels: [] }));
    expect(again.status).toBe(409);
    // Maria can't take that time now either.
    const taken = await PICK(json({ action: 'pick', interviewId: id, at: picked }), { params: { token } });
    expect(taken.status).toBe(409);
    expect((await taken.json()).error).toBe('Someone just took that time. Please pick another.');
    await db.interview.updateMany({ where: { applicationId: app2 }, data: { status: 'CANCELLED' } });
  });

  it('the candidate picks a time and everyone gets a calendar invite', async () => {
    out.emails.length = 0;
    const res = await PICK(json({ action: 'pick', interviewId: id, at: picked }), { params: { token } });
    expect((await res.json()).message).toMatch(/^You’re booked for /);
    const toMaria = out.emails.find((m) => m.to === 'maria@x.test')!;
    expect(toMaria.subject).toMatch(/^Acme: interview confirmed for /);
    expect(toMaria.text).toContain('Join: https://meet.example/abc');
    expect(toMaria.attachments![0].content.toString()).toContain('METHOD:REQUEST');
    expect(out.emails.filter((m) => String(m.to).endsWith(`@${RUN}.test`)).map((m) => m.to).sort()).toEqual([`ann@${RUN}.test`, `ben@${RUN}.test`]);
    expect((await PICK(json({ action: 'pick', interviewId: id, at: picked }), { params: { token } })).status).toBe(409);
    const page = await (await PAGE(new Request('http://x'), { params: { token } })).json();
    expect(page.interviews[0]).toMatchObject({ status: 'SCHEDULED', location: 'https://meet.example/abc' });
  });

  it('reminds the candidate the day before and nudges interviewers for scorecards after', async () => {
    const o = (await db.organization.findFirstOrThrow({ where: { id: org } }));
    const iv = await db.interview.findFirstOrThrow({ where: { id } });
    const before = new Date(iv.startsAt!.getTime() - 20 * 3600e3);
    out.emails.length = 0;
    expect(await runInterviewReminders(o, before)).toMatchObject({ reminded: 1 });
    expect(out.emails[0].subject).toMatch(/^Reminder: your interview /);
    expect((await runInterviewReminders(o, before)).reminded).toBe(0); // once only
    const after = new Date(iv.startsAt!.getTime() + 4 * 3600e3);
    expect((await runInterviewReminders(o, after)).nudged).toBe(2);
    expect(await db.task.count({ where: { organizationId: org, related: { startsWith: `scorecard:${id}:` }, done: false } })).toBe(2);
  });

  it('scorecards: interviewers see the others only after submitting their own', async () => {
    // Pretend the interview happened.
    await db.interview.updateMany({ where: { id }, data: { startsAt: new Date(Date.now() - 2 * 3600e3) } });
    as(viewer);
    const notMine = await SCORE(json({ ratings: { Communication: 3 }, recommendation: 'YES' }), { params: { id } });
    expect(notMine.status).toBe(200); // admins may add one
    as(ann);
    expect((await SCORE(json({ ratings: { Juggling: 4 }, recommendation: 'YES' }), { params: { id } })).status).toBe(400);
    expect((await SCORE(json({ ratings: { Communication: 4 } }), { params: { id } })).status).toBe(400);
    let d = await (await DETAIL(new Request('http://x'), { params: { id } })).json();
    expect(d).toMatchObject({ hidden: 1, summary: null, competencies: ['Communication', 'Reliability and attendance', 'Safety mindset', 'Teamwork', 'Forklift'] });
    await SCORE(json({ ratings: { Communication: 4, Forklift: 4 }, recommendation: 'STRONG_YES', notes: 'Ran the night crew.' }), { params: { id } });
    d = await (await DETAIL(new Request('http://x'), { params: { id } })).json();
    expect(d.hidden).toBe(0);
    expect(d.scorecards).toHaveLength(2);
    expect(d.summary).toMatchObject({ count: 2, verdict: 'Yes' });
    expect(d.status).toBe('COMPLETED');
    expect(await db.task.count({ where: { related: `scorecard:${id}:${ann}`, done: false } })).toBe(0);
    const feedback = await (await LIST(new Request('http://x/?view=feedback'))).json();
    expect(feedback.find((x: { id: string }) => x.id === id)).toBeUndefined(); // Ann has submitted
    as(ben);
    expect((await (await LIST(new Request('http://x/?view=feedback'))).json()).map((x: { id: string }) => x.id)).toContain(id);
  });

  it('cancelling a booked interview sends cancellations', async () => {
    as(ann);
    const iv2 = await (await CREATE(json({ applicationId: app, kind: 'ONSITE', durationMin: 60, location: '400 Dock Rd', interviewerIds: [ann], slots: [`${day(6)}T11:00`], channels: [] }))).json();
    out.emails.length = 0;
    const res = await CHANGE(json({ action: 'cancel', reason: 'The client paused the role.' }, 'PATCH'), { params: { id: iv2.id } });
    expect((await res.json()).ok).toBe(true);
    expect(out.emails.find((m) => m.to === 'maria@x.test')!.attachments![0].content.toString()).toContain('METHOD:CANCEL');
    expect((await CREATE(json({ applicationId: app, kind: 'ONSITE', durationMin: 60, interviewerIds: [ann], slots: [`${day(6)}T11:00`] }))).status).toBe(400); // in person needs an address
  });
});

describe('redeployment', () => {
  it('lists assignments ending soon with matched jobs, and acts on them', async () => {
    as(ann);
    const o = await db.organization.findFirstOrThrow({ where: { id: org } });
    const w = (await db.candidate.create({ data: { organizationId: org, name: 'Lee Park', phone: '(305) 555-0199', skills: ['Forklift'] } })).id;
    const cur = (await db.job.create({ data: { organizationId: org, title: 'Picker', type: 'TEMP', status: 'FILLED' } })).id;
    const placed = (await db.application.create({ data: { organizationId: org, candidateId: w, jobId: cur, stage: 'PLACED', maxStage: 'PLACED', assignmentEnd: new Date(`${day(5)}T00:00:00Z`) } })).id;
    // A worker whose shifts simply stop also shows up, with the end inferred.
    const w2 = (await db.candidate.create({ data: { organizationId: org, name: 'Kim Diaz' } })).id;
    const a2 = (await db.application.create({ data: { organizationId: org, candidateId: w2, jobId: cur, stage: 'PLACED', maxStage: 'PLACED' } })).id;
    await db.shift.create({ data: { organizationId: org, applicationId: a2, date: new Date(`${day(2)}T00:00:00Z`), start: '07:00', end: '15:00' } as never });
    // And one with work lined up after doesn't.
    const w3 = (await db.candidate.create({ data: { organizationId: org, name: 'Pat Busy' } })).id;
    await db.application.create({ data: { organizationId: org, candidateId: w3, jobId: cur, stage: 'PLACED', maxStage: 'PLACED', assignmentEnd: new Date(`${day(4)}T00:00:00Z`) } });
    const next = (await db.job.create({ data: { organizationId: org, title: 'Next Job', type: 'TEMP', status: 'FILLED' } })).id;
    await db.application.create({ data: { organizationId: org, candidateId: w3, jobId: next, stage: 'PLACED', maxStage: 'PLACED', assignmentEnd: new Date(`${day(60)}T00:00:00Z`) } });
    const list = await (await ENDING()).json();
    expect(list.map((e: { name: string }) => e.name)).toEqual(['Kim Diaz', 'Lee Park']);
    expect(list[0]).toMatchObject({ inferred: true, endDate: day(2) });
    const lee = list[1];
    expect(lee).toMatchObject({ inferred: false, daysLeft: expect.any(Number) });
    expect(lee.matches[0]).toMatchObject({ jobId: job, title: 'Forklift Operator' }); // the open job with the skill they have
    expect(await runRedeployTasks(o)).toBe(2);
    expect(await runRedeployTasks(o)).toBe(0);
    expect(await (await REDEPLOY(json({ action: 'text', applicationId: placed, jobId: job }))).json()).toEqual({ message: 'Texted Lee Park about Forklift Operator.' });
    expect(out.texts.at(-1)!.body).toMatch(/^Acme: hi Lee, your assignment is wrapping up and we have a Forklift Operator opening/);
    expect(await (await REDEPLOY(json({ action: 'submit', applicationId: placed, jobId: job }))).json()).toMatchObject({ message: expect.stringContaining('as Submitted') });
    expect(await db.application.findFirst({ where: { candidateId: w, jobId: job, stage: 'SUBMITTED', source: 'redeploy' } })).not.toBeNull();
    expect(await db.task.count({ where: { related: `redeploy:${placed}`, done: false } })).toBe(0);
    expect((await REDEPLOY(json({ action: 'handled', applicationId: a2, note: '' }))).status).toBe(400);
    await REDEPLOY(json({ action: 'handled', applicationId: a2, note: 'Extended two weeks by the client' }));
    expect((await (await ENDING()).json()).map((e: { name: string }) => e.name)).toEqual(['Lee Park']);
  });
});
