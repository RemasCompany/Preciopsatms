import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; orgId: string } } }));
const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[] }));
vi.mock('next-auth', async (orig) => ({ ...(await orig<typeof import('next-auth')>()), getServerSession: vi.fn(async () => session.current) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (o: { to: string; subject: string; text: string }) => { mail.sent.push(o); return { id: `em_${mail.sent.length}` }; }) }));

import { db } from '@/lib/db';
import { limited } from '@/lib/rate-limit';
import { buildEvent, captureError, scrub } from '@/lib/monitoring';
import { withApi } from '@/lib/tenant';
import { runDueTasks, runTask } from '@/lib/task-runner';
import { POST as SEND } from '@/app/api/messages/send/route';
import { GET as PROGRESS } from '@/app/api/tasks/[id]/route';
import { POST as RUN_TASK } from '@/app/api/tasks/[id]/run/route';
import { GET as CRON } from '@/app/api/cron/tasks/route';
import { POST as CLIENT_ERROR } from '@/app/api/client-error/route';

const RUN = `bg${Date.now()}`;
let org: string, user: string, other: string, cands: string[] = [];
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete process.env.SENTRY_DSN; delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN; });

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: 'Bulk Co', slug: `b-${RUN}`, plan: 'growth', subscriptionStatus: 'active' } })).id;
  user = (await db.user.create({ data: { email: `r@${RUN}.test`, name: 'Rae', passwordHash: 'x' } })).id;
  other = (await db.user.create({ data: { email: `o@${RUN}.test`, name: 'Otto', passwordHash: 'x' } })).id;
  await db.membership.createMany({ data: [{ userId: user, organizationId: org, role: 'RECRUITER' }, { userId: other, organizationId: org, role: 'RECRUITER' }] });
  await db.candidate.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ organizationId: org, name: `Person ${i}`, email: `p${i}@${RUN}.test`, emailOptOut: i === 7 })) });
  cands = (await db.candidate.findMany({ where: { organizationId: org }, orderBy: { name: 'asc' } })).map((c) => c.id);
  session.current = { user: { id: user, orgId: org } };
});
afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { endsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${RUN}.test` } } });
  await db.$disconnect();
});

describe('rate limiting', () => {
  it('counts in memory without Upstash', async () => {
    const r = [];
    for (let i = 0; i < 4; i++) r.push(await limited('t-mem', 'k', 3, 60e3));
    expect(r).toEqual([false, false, false, true]);
  });
  it('uses Upstash when configured, and falls back when it fails', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test'; process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
    const calls: { url: string; body: string; auth: string }[] = [];
    let n = 0;
    globalThis.fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body), auth: (init.headers as Record<string, string>).Authorization });
      return new Response(JSON.stringify([{ result: ++n }, { result: 1 }]));
    }) as never;
    expect(await limited('t-up', 'ip1', 2, 60e3)).toBe(false);
    expect(await limited('t-up', 'ip1', 2, 60e3)).toBe(false);
    expect(await limited('t-up', 'ip1', 2, 60e3)).toBe(true);
    expect(calls[0]).toMatchObject({ url: 'https://redis.test/pipeline', auth: 'Bearer tok' });
    expect(JSON.parse(calls[0].body)[0][0]).toBe('INCR');
    globalThis.fetch = vi.fn(async () => { throw new Error('down'); }) as never;
    expect(await limited('t-up2', 'ip1', 1, 60e3)).toBe(false); // memory fallback still works
    expect(await limited('t-up2', 'ip1', 1, 60e3)).toBe(true);
  });
});

describe('error monitoring', () => {
  it('scrubs personal data', () => {
    expect(scrub('No user ana@x.test at +1 (407) 555-0100 via /shifts/abcdefghijklmnopqrstu')).toBe('No user [email] at [number] via /shifts/[token]');
    const ev = buildEvent(new Error('Boom for ana@x.test'), { route: '/api/x', userId: 'u1' });
    expect(ev.exception.values[0]).toMatchObject({ type: 'Error', value: 'Boom for [email]' });
    expect(ev.user).toEqual({ id: 'u1' });
    expect(ev.exception.values[0].stacktrace.frames.length).toBeGreaterThan(0);
  });
  it('sends an envelope to Sentry only when SENTRY_DSN is set', async () => {
    const posts: { url: string; body: string; auth: string }[] = [];
    globalThis.fetch = vi.fn(async (url: string, init: RequestInit) => { posts.push({ url, body: String(init.body), auth: (init.headers as Record<string, string>)['X-Sentry-Auth'] }); return new Response('{}'); }) as never;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await captureError(new Error('quiet'));
    expect(posts).toHaveLength(0);
    process.env.SENTRY_DSN = 'https://pubkey@o1.ingest.sentry.io/42';
    const handler = withApi(async (_req: Request) => { throw new Error('db exploded for bob@x.test'); });
    const res = await handler(new Request('http://x/api/things?email=bob@x.test'));
    expect([res.status, (await res.json()).error]).toEqual([500, 'Something went wrong']);
    expect(posts[0].url).toBe('https://o1.ingest.sentry.io/api/42/envelope/');
    expect(posts[0].auth).toContain('sentry_key=pubkey');
    const event = JSON.parse(posts[0].body.split('\n')[2]);
    expect(event.tags).toMatchObject({ route: '/api/things', method: 'GET' });
    expect(posts[0].body).not.toContain('bob@x.test');
  });
  it('accepts browser crash reports', async () => {
    process.env.SENTRY_DSN = 'https://pubkey@o1.ingest.sentry.io/42';
    const posts: string[] = [];
    globalThis.fetch = vi.fn(async (_u: string, init: RequestInit) => { posts.push(String(init.body)); return new Response('{}'); }) as never;
    const r = await CLIENT_ERROR(new Request('http://x', { method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: JSON.stringify({ message: 'x is undefined', path: '/app/candidates?q=ana' }) }));
    expect(r.status).toBe(204);
    const event = JSON.parse(posts[0].split('\n')[2]);
    expect(event).toMatchObject({ platform: 'javascript', tags: { route: '/app/candidates' } });
  });
});

describe('background sends', () => {
  const body = { channel: 'email', recipientType: 'candidate', subject: 'Hi {{first_name}}', body: 'Hello {{first_name}}' };
  const post = (ids: string[]) => SEND(new Request('http://x', { method: 'POST', body: JSON.stringify({ ...body, recipientIds: ids }) }));
  const P = (id: string) => ({ params: { id } });

  it('sends small lists right away', async () => {
    mail.sent = [];
    const r = await post(cands.slice(0, 3));
    expect(await r.json()).toEqual({ sent: 3, skipped: 0, failed: 0 });
  });

  it('queues large lists, resumes after running out of time, and never sends twice', async () => {
    mail.sent = [];
    const r = await post(cands);
    expect(r.status).toBe(202);
    const { taskId, total } = await r.json();
    expect(total).toBe(30);
    expect(await (await PROGRESS(new Request('http://x'), P(taskId))).json()).toMatchObject({ status: 'queued', sent: 0, total: 30 });
    // Another recruiter can't see or start it.
    session.current = { user: { id: other, orgId: org } };
    expect((await PROGRESS(new Request('http://x'), P(taskId))).status).toBe(404);
    session.current = { user: { id: user, orgId: org } };
    // No time at all: it yields straight back to the queue without using up an attempt.
    expect(await runTask(taskId, 0)).toBe(true);
    expect(await db.backgroundTask.findUnique({ where: { id: taskId } })).toMatchObject({ status: 'queued', attempts: 0 });
    // Two workers at once: only one gets it.
    const [a, b] = await Promise.all([runTask(taskId), runTask(taskId)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const p = await (await PROGRESS(new Request('http://x'), P(taskId))).json();
    expect(p).toMatchObject({ status: 'done', sent: 29, skipped: 1, failed: 0, total: 30 });
    expect(mail.sent).toHaveLength(29);
    expect(new Set(mail.sent.map((m) => m.to)).size).toBe(29);
    expect((await RUN_TASK(new Request('http://x', { method: 'POST' }), P(taskId))).status).toBe(200); // already done: no-op
    expect(mail.sent).toHaveLength(29);
  });

  it('continues where it stopped after a crash', async () => {
    mail.sent = [];
    const { taskId } = await (await post(cands)).json();
    // Pretend a worker sent to the first 10 and then died.
    const first = cands.slice(0, 10);
    await db.backgroundTask.update({ where: { id: taskId }, data: { status: 'running', lockedAt: new Date(Date.now() - 11 * 60e3), progress: { sent: 10, skipped: 0, failed: 0, total: 30, done: first } } });
    const r = await runDueTasks(20_000);
    expect(r.recovered).toBe(1);
    expect(mail.sent.map((m) => m.to).some((to) => ['p0@', 'p1@'].some((x) => to.startsWith(x)))).toBe(false);
    expect(await (await PROGRESS(new Request('http://x'), P(taskId))).json()).toMatchObject({ status: 'done', sent: 29 });
  });

  it('retries with backoff, then gives up', async () => {
    const { taskId } = await (await post(cands)).json();
    await db.membership.updateMany({ where: { userId: user, organizationId: org }, data: { role: 'VIEWER' } });
    await runTask(taskId);
    const t = await db.backgroundTask.findUnique({ where: { id: taskId } });
    expect(t).toMatchObject({ status: 'queued', attempts: 1, lastError: 'The person who queued this send is no longer on the team.' });
    expect(t!.runAt.getTime()).toBeGreaterThan(Date.now() + 50e3);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (let i = 0; i < 2; i++) { await db.backgroundTask.update({ where: { id: taskId }, data: { runAt: new Date() } }); await runTask(taskId); }
    expect(await db.backgroundTask.findUnique({ where: { id: taskId } })).toMatchObject({ status: 'failed', attempts: 3 });
    await db.membership.updateMany({ where: { userId: user, organizationId: org }, data: { role: 'RECRUITER' } });
  });

  it('the scheduled job needs the secret', async () => {
    process.env.CRON_SECRET = 'cron-secret-value';
    expect((await CRON(new Request('http://x'))).status).toBe(401);
    expect((await CRON(new Request('http://x', { headers: { authorization: 'Bearer cron-secret-value' } }))).status).toBe(200);
  });
});
