import { Prisma, type BackgroundTask } from '@prisma/client';
import { db } from './db';
import { captureError } from './monitoring';

/** Thrown by a handler that ran out of time: the task goes back in the queue without using up an attempt. */
export class Yield extends Error { constructor() { super('yield'); } }

export type TaskCtx = { task: BackgroundTask; deadline: number; progress: (p: Prisma.InputJsonValue) => Promise<void> };
type Handler = (ctx: TaskCtx) => Promise<Prisma.InputJsonValue>;
const handlers = new Map<string, Handler>();
export const registerTask = (kind: string, h: Handler) => { handlers.set(kind, h); };

const STALE_MS = 10 * 60e3;

export async function enqueue(orgId: string, kind: string, payload: Prisma.InputJsonValue, createdById?: string) {
  return db.backgroundTask.create({ data: { organizationId: orgId, kind, payload, createdById } });
}

/** Claims one due task (or the given one) so no other worker can take it. */
async function claim(id?: string): Promise<BackgroundTask | null> {
  const rows = await db.$queryRaw<BackgroundTask[]>`
    UPDATE "BackgroundTask" SET status = 'running', "lockedAt" = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM "BackgroundTask"
      WHERE status = 'queued' AND "runAt" <= now() ${id ? Prisma.sql`AND id = ${id}` : Prisma.empty}
      ORDER BY "runAt" LIMIT 1 FOR UPDATE SKIP LOCKED
    ) RETURNING *`;
  return rows[0] ?? null;
}

async function execute(task: BackgroundTask, budgetMs: number) {
  const h = handlers.get(task.kind);
  const done = (data: Prisma.BackgroundTaskUpdateManyMutationInput) => db.backgroundTask.updateMany({ where: { id: task.id, status: 'running' }, data });
  if (!h) return done({ status: 'failed', lastError: `No handler for ${task.kind}`, finishedAt: new Date() });
  try {
    const result = await h({ task, deadline: Date.now() + budgetMs, progress: async (p) => { await db.backgroundTask.updateMany({ where: { id: task.id }, data: { progress: p, lockedAt: new Date() } }); } });
    await done({ status: 'done', result, finishedAt: new Date(), lastError: null });
  } catch (e) {
    if (e instanceof Yield) return done({ status: 'queued', attempts: { decrement: 1 }, lockedAt: null });
    const msg = String((e as Error)?.message ?? e).slice(0, 500);
    if (task.attempts >= task.maxAttempts) {
      await captureError(e, { tags: { task: task.kind }, orgId: task.organizationId });
      return done({ status: 'failed', lastError: msg, finishedAt: new Date() });
    }
    // Try again later: 1, 4, 16 minutes.
    return done({ status: 'queued', lastError: msg, lockedAt: null, runAt: new Date(Date.now() + 4 ** (task.attempts - 1) * 60e3) });
  }
}

/** Puts tasks whose worker died (no heartbeat for 10 minutes) back in the queue. */
export async function recoverStale() {
  const { count } = await db.backgroundTask.updateMany({ where: { status: 'running', lockedAt: { lt: new Date(Date.now() - STALE_MS) } }, data: { status: 'queued', lockedAt: null } });
  return count;
}

/** Runs one specific queued task now (e.g. right after the browser queued it). */
export async function runTask(id: string, budgetMs = 250_000) {
  const t = await claim(id);
  if (t) await execute(t, budgetMs);
  return !!t;
}

/** Works through due tasks until the time budget is spent. Called by the scheduled job. */
export async function runDueTasks(budgetMs = 250_000) {
  const end = Date.now() + budgetMs;
  const recovered = await recoverStale();
  let ran = 0;
  while (Date.now() < end - 5000) {
    const t = await claim();
    if (!t) break;
    await execute(t, end - Date.now() - 5000);
    ran++;
  }
  return { ran, recovered };
}
