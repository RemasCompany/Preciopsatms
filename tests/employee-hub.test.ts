import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const out = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; text: string }[], sms: [] as { to: string; body: string }[] }));
const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: (typeof out.emails)[number]) => { out.emails.push(o); return { id: `em_${out.emails.length}` }; }) }));
vi.mock('@/lib/sms', async (orig) => ({ ...(await orig<typeof import('@/lib/sms')>()), sendSms: vi.fn(async (to: string, body: string) => { out.sms.push({ to, body }); return { id: `sm_${out.sms.length}` }; }) }));

import { db } from '@/lib/db';
import { newToken, sha256 } from '@/lib/tokens';
import { resolveWorkerLink } from '@/lib/schedule-server';
import { employeeAction, employeeHub } from '@/lib/self-service';
import { imageType } from '@/lib/employee-hub';
import { POST as CREATE } from '@/app/api/records/[kind]/route';
import { POST as STAFF_UPDATE } from '@/app/api/records/[kind]/[id]/updates/route';
import { PATCH as ENROLLMENT } from '@/app/api/training/enrollments/[id]/route';
import { GET as MY_PHOTO, POST as UPLOAD } from '@/app/api/public/me/[token]/photo/route';
import { GET as TEAM_PHOTO } from '@/app/api/candidates/[id]/photo/route';

const RUN = `ehub${Date.now()}`;
let org: string, other: string, user: string, ana: string, anaCand: string, ben: string, token: string, ownJob: string;
const linkFor = async (candidateId: string, organizationId = org) => {
  const t = newToken();
  await db.workerLink.create({ data: { organizationId, candidateId, tokenHash: sha256(t), kind: 'timeclock', expiresAt: new Date(Date.now() + 864e5) } });
  return t;
};
const act = async (body: object, t = token) => employeeAction((await resolveWorkerLink(t))!, body);
const hub = async (t = token) => (await employeeHub((await resolveWorkerLink(t))!))!;
const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeAll(async () => {
  process.env.APP_URL = 'https://app.test';
  org = (await db.organization.create({ data: { name: 'Northwind Foods', shortName: 'Northwind', slug: `nw-${RUN}`, plan: 'enterprise', subscriptionStatus: 'active', kind: 'EMPLOYER' } })).id;
  other = (await db.organization.create({ data: { name: 'Other Co', slug: `ot-${RUN}`, plan: 'growth', subscriptionStatus: 'active', kind: 'EMPLOYER' } })).id;
  user = (await db.user.create({ data: { email: `hr@${RUN}.test`, name: 'Hana HR', passwordHash: 'x' } })).id;
  await db.membership.create({ data: { userId: user, organizationId: org, role: 'ADMIN' } });
  session.current = { user: { id: user, orgId: org } };
  ownJob = (await db.job.create({ data: { organizationId: org, title: 'Picker', status: 'OPEN', type: 'FULL_TIME' } })).id;
  const emp = async (name: string, o: { email?: string; phone?: string; emailOptOut?: boolean }, organizationId = org) => {
    const c = await db.candidate.create({ data: { organizationId, name, email: o.email ?? null, phone: o.phone ?? null, emailOptOut: !!o.emailOptOut, skills: ['Forklift'] } });
    const a = organizationId === org ? await db.application.create({ data: { organizationId, candidateId: c.id, jobId: ownJob, stage: 'PLACED', maxStage: 'PLACED' } }) : null;
    const e = await db.employee.create({ data: { organizationId, candidateId: c.id, applicationId: a?.id, title: 'Picker', startDate: new Date('2024-01-08T00:00:00Z'), payRate: 20 } });
    return { e: e.id, c: c.id };
  };
  ({ e: ana, c: anaCand } = await emp('Ana Ruiz', { email: 'ana@nw.test' }));
  ({ e: ben } = await emp('Ben Ode', { phone: '(312) 555-0142', email: 'ben@nw.test', emailOptOut: true }));
  token = await linkFor(anaCand);
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('employee profile', () => {
  it('walks them through a complete profile', async () => {
    let h = await hub();
    expect(h.profileComplete).toBe(false);
    expect(h.steps.filter((s) => !s.done).map((s) => s.key)).toEqual(['photo', 'address', 'emergency']); // email and skills came from hiring
    await expect(act({ action: 'profile', emergencyPhone: '555-0100' })).rejects.toThrow('emergency contact’s name');
    await expect(act({ action: 'profile', phone: 'call me' })).rejects.toThrow('Use digits');
    expect(await act({ action: 'profile', preferredName: 'Annie', pronouns: 'she/her', homeAddress: '12 Elm St, Austin, TX', emergencyName: 'Luis Ruiz', emergencyRelation: 'Brother', emergencyPhone: '(512) 555-0101', bio: 'Night shift lead.', skills: ['Forklift', 'RF scanner', 'Forklift'] }))
      .toEqual({ message: 'Saved.' });
    h = await hub();
    expect(h.profile).toMatchObject({ preferredName: 'Annie', emergencyName: 'Luis Ruiz', skills: ['Forklift', 'RF scanner'] });
    expect(h.steps.filter((s) => !s.done).map((s) => s.key)).toEqual(['photo']);
  });

  it('takes a JPEG or PNG picture (checked by its bytes) and completes the profile', async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 1)]);
    expect(imageType(jpeg)).toBe('image/jpeg');
    expect(imageType(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
    const up = (body: Buffer) => UPLOAD(new Request('http://x', { method: 'POST', body: new Uint8Array(body) }), { params: { token } });
    expect((await up(Buffer.from('<html>not a picture</html>'))).status).toBe(415);
    expect((await up(Buffer.alloc(3 * 1024 * 1024, 0xff))).status).toBe(413);
    expect(await (await up(jpeg)).json()).toEqual({ message: 'Picture saved.' });
    // Replacing it leaves one stored file.
    await up(jpeg);
    expect(await db.storedFile.count({ where: { organizationId: org, filename: { startsWith: 'photo-' } } })).toBe(1);
    const mine = await MY_PHOTO(new Request('http://x'), { params: { token } });
    expect(mine.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await mine.arrayBuffer()).equals(jpeg)).toBe(true);
    expect((await TEAM_PHOTO(new Request('http://x'), { params: { id: anaCand } })).status).toBe(200);
    // The picture was the last step: the profile is complete, whichever order they went in.
    expect((await hub()).profileComplete).toBe(true);
    expect((await db.employee.findFirstOrThrow({ where: { id: ana } })).profileCompletedAt).not.toBeNull();
  });
});

describe('tasks for employees', () => {
  let taskId: string;
  it('assigning a task tells the employee and shows it as new on their page', async () => {
    const res = await CREATE(new Request('http://x', json({ title: 'Finish forklift refresher', employeeId: ana, details: 'Lessons 1–3 before Friday.', dueAt: '2026-10-23' })), { params: { kind: 'tasks' } });
    expect(res.status).toBe(201);
    taskId = (await res.json()).id;
    const mail = out.emails.at(-1)!;
    expect(mail.to).toBe('ana@nw.test');
    expect(mail.subject).toBe('Northwind: New task — Finish forklift refresher');
    expect(mail.text).toMatch(/https:\/\/app\.test\/shifts\/[\w-]+#tasks/);
    expect(await db.message.count({ where: { organizationId: org, relatedId: anaCand, status: 'sent' } })).toBe(1);
    const t = (await hub()).tasks.find((x) => x.id === taskId)!;
    expect(t).toMatchObject({ title: 'Finish forklift refresher', details: 'Lessons 1–3 before Friday.', dueAt: '2026-10-23', isNew: true, done: false });
    expect((await hub()).tasks.find((x) => x.id === taskId)!.isNew).toBe(true); // loading again doesn't count as seeing it
    expect(await act({ action: 'seenTasks' })).toEqual({ ok: true }); // the page showed it
    expect((await hub()).tasks.find((x) => x.id === taskId)!.isNew).toBe(false);
    // The link in the message opens Ana's page.
    const t2 = mail.text.match(/\/shifts\/([\w-]+)/)![1];
    expect((await hub(t2)).tasks.some((x) => x.id === taskId)).toBe(true);
  });

  it('updates go both ways, and only the team’s count as new for the employee', async () => {
    expect(await act({ action: 'task', taskId, update: 'Done with lesson 1.' })).toEqual({ message: 'Update sent.' });
    await STAFF_UPDATE(new Request('http://x', json({ body: 'Great — lesson 2 has the new video.' })), { params: { kind: 'tasks', id: taskId } });
    expect(out.emails.at(-1)!.subject).toBe('Northwind: Task update — Finish forklift refresher');
    // The first notice's link still opens the page.
    expect((await resolveWorkerLink(out.emails.find((m) => m.subject.includes('New task — Finish'))!.text.match(/\/shifts\/([\w-]+)/)![1]))).not.toBeNull();
    const t = (await hub()).tasks.find((x) => x.id === taskId)!;
    expect(t.newUpdates).toBe(1);
    await act({ action: 'seenTasks' });
    expect((await hub()).tasks.find((x) => x.id === taskId)!.newUpdates).toBe(0);
    expect(t.updates.map((u) => [u.author, u.body])).toEqual([['You', 'Done with lesson 1.'], ['Hana HR', 'Great — lesson 2 has the new video.']]);
    expect(await act({ action: 'task', taskId, done: true })).toEqual({ message: 'Marked done. Thanks!' });
    const row = await db.task.findFirstOrThrow({ where: { id: taskId } });
    expect(row.done).toBe(true);
    expect(row.doneAt).not.toBeNull();
  });

  it('honors opt-outs and keeps tasks private to the person', async () => {
    const before = out.emails.length;
    const res = await CREATE(new Request('http://x', json({ title: 'Badge photo', employeeId: ben })), { params: { kind: 'tasks' } });
    const benTask = (await res.json()).id;
    expect(out.emails.length).toBe(before); // Ben opted out of email, so he gets a text
    expect(out.sms.at(-1)!.body).toMatch(/^Northwind: You have a new task: “Badge photo”\. See it here: https:\/\/app\.test\/shifts\/[\w-]+#tasks$/);
    await expect(act({ action: 'task', taskId: benTask, done: true })).rejects.toThrow('isn’t assigned to you');
    expect((await hub()).tasks.some((t) => t.id === benTask)).toBe(false);
    // Someone at another company can't reach it either.
    const c = await db.candidate.create({ data: { organizationId: other, name: 'Zed' } });
    await db.employee.create({ data: { organizationId: other, candidateId: c.id, title: 'Clerk', startDate: new Date('2025-01-06T00:00:00Z'), payRate: 18 } });
    await expect(act({ action: 'task', taskId: benTask, done: true }, await linkFor(c.id, other))).rejects.toThrow('isn’t assigned to you');
    // Only current employees can be assigned.
    await db.employee.updateMany({ where: { id: ben }, data: { status: 'TERMINATED' } });
    expect((await CREATE(new Request('http://x', json({ title: 'x', employeeId: ben })), { params: { kind: 'tasks' } })).status).toBe(400);
    await db.employee.updateMany({ where: { id: ben }, data: { status: 'ACTIVE' } });
  });
});

describe('internal jobs', () => {
  it('lists open jobs posted to employees and applies with their profile', async () => {
    const lead = await db.job.create({ data: { organizationId: org, title: 'Shift Lead', status: 'OPEN', internal: true, publish: false, type: 'FULL_TIME', skills: ['Forklift'] } });
    await db.job.create({ data: { organizationId: org, title: 'Public only', status: 'OPEN', type: 'FULL_TIME' } });
    await db.job.create({ data: { organizationId: org, title: 'Closed internal', status: 'CLOSED', internal: true, type: 'FULL_TIME' } });
    await db.job.updateMany({ where: { id: ownJob }, data: { internal: true } });
    expect((await hub()).jobs.map((j) => j.title)).toEqual(['Shift Lead']); // not their own job
    expect(await act({ action: 'applyJob', jobId: lead.id, note: 'I’ve covered the lead role on nights.' })).toEqual({ message: 'Applied for Shift Lead. The hiring team will be in touch.' });
    const app = await db.application.findFirstOrThrow({ where: { jobId: lead.id, candidateId: anaCand } });
    expect(app).toMatchObject({ stage: 'APPLIED', source: 'internal' });
    expect((await db.task.findFirstOrThrow({ where: { related: `application:${app.id}` } })).title).toContain('Internal applicant: Ana Ruiz (Picker) applied for Shift Lead');
    expect((await hub()).jobs[0]).toMatchObject({ applied: true, status: 'in review' });
    await expect(act({ action: 'applyJob', jobId: lead.id })).rejects.toThrow('already applied');
    const pub = await db.job.findFirstOrThrow({ where: { organizationId: org, title: 'Public only' } });
    await expect(act({ action: 'applyJob', jobId: pub.id })).rejects.toThrow('no longer open');
  });
});

describe('training sign-up', () => {
  const course = (title: string, signup: string) => db.trainingCourse.create({ data: { organizationId: org, title, certType: 'Forklift – sit-down counterbalance', signup, lessons: [{ title: 'L1', body: 'b' }], questions: [], checklist: ['x'] } });
  it('open courses enrol them; others need a manager’s approval', async () => {
    const open = await course('Forklift basics', 'open');
    const ask = await course('Reach truck', 'approval');
    await course('Hidden', 'none');
    expect((await hub()).courses.map((c) => [c.title, c.needsApproval, c.state])).toEqual([['Forklift basics', false, null], ['Reach truck', true, null]]);
    expect(await act({ action: 'trainingSignup', courseId: open.id })).toMatchObject({ message: expect.stringContaining('You’re signed up') });
    expect(await act({ action: 'trainingSignup', courseId: ask.id, note: 'For the new aisle.' })).toMatchObject({ message: expect.stringContaining('Request sent') });
    await expect(act({ action: 'trainingSignup', courseId: ask.id })).rejects.toThrow('already signed up');
    expect((await hub()).courses.map((c) => c.state)).toEqual(['taking', 'requested']);
    const req = await db.trainingEnrollment.findFirstOrThrow({ where: { courseId: ask.id, candidateId: anaCand } });
    expect(req).toMatchObject({ status: 'requested', requestNote: 'For the new aisle.' });
    expect(await db.task.count({ where: { related: `training:${ask.id}`, done: false } })).toBe(1);
    const res = await ENROLLMENT(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ action: 'approve' }) }), { params: { id: req.id } });
    expect(res.status).toBe(200);
    expect((await db.trainingEnrollment.findFirstOrThrow({ where: { id: req.id } })).status).toBe('assigned');
    expect(await db.task.count({ where: { related: `training:${ask.id}`, done: false } })).toBe(0);
    expect((await hub()).courses.map((c) => c.state)).toEqual(['taking', 'taking']);
  });
});

describe('time off', () => {
  it('still works from the same page', async () => {
    const p = await db.leavePolicy.create({ data: { organizationId: org, name: 'Unpaid leave', paid: false, method: 'NONE' } });
    expect((await hub()).timeOff!.policies.map((x) => x.name)).toContain('Unpaid leave');
    expect(((await act({ action: 'leave', policyId: p.id, startDate: '2026-12-21', endDate: '2026-12-22', hoursPerDay: 8 })) as { message: string }).message).toMatch(/^Sent\./);
  });
});
