import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { Prisma, type Role } from '@prisma/client';
import { authOptions } from './auth';
import { db } from './db';
import { hasFeature, planIncludes, type Feature } from './plans';
import { captureError, cleanPath } from './monitoring';

// Models that carry organizationId. Every query through tenantDb() is forced into the caller's org.
const TENANT_MODELS = new Set<string>([
  'Job', 'Candidate', 'Application', 'EeoSelfId', 'Client', 'Contact', 'Deal', 'Lead', 'Vendor', 'Task',
  'Timesheet', 'SignDocument', 'Message', 'Activity', 'StoredFile', 'Invite', 'SalesTarget', 'Credential', 'Shift', 'WorkerLink', 'PayrollRun', 'PayrollItem', 'PayrollAdjustment', 'TimeEntry', 'OnboardingPackage', 'Onboarding', 'OnboardingStep', 'Feedback', 'FeedbackRequest', 'Recognition', 'AuditLog', 'BackgroundTask',
]);
// Written once, never changed: the audit log is evidence.
const APPEND_ONLY = new Set(['AuditLog']);
const SCOPED_READS = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany']);
const UNSCOPABLE = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert']);

export function tenantDb(orgId: string) {
  return db.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          if (APPEND_ONLY.has(model) && (operation === 'updateMany' || operation === 'deleteMany')) throw new Error(`tenantDb: ${model} is append-only`);
          const a = (args ?? {}) as Record<string, unknown>;
          if (SCOPED_READS.has(operation)) a.where = { ...(a.where as object), organizationId: orgId };
          else if (operation === 'create') a.data = { ...(a.data as object), organizationId: orgId };
          else if (operation === 'createMany') {
            const d = a.data as object | object[];
            a.data = Array.isArray(d) ? d.map((x) => ({ ...x, organizationId: orgId })) : { ...d, organizationId: orgId };
          } else if (UNSCOPABLE.has(operation)) {
            // Unique-key operations can't be scoped safely. Use findFirst / updateMany / deleteMany instead.
            throw new Error(`tenantDb: ${model}.${operation} is not allowed; use a scoped variant`);
          }
          return query(a as never);
        },
      },
    },
  });
}
export type TenantDb = ReturnType<typeof tenantDb>;

const RANK: Record<Role, number> = { VIEWER: 0, RECRUITER: 1, ADMIN: 2, OWNER: 3 };

import { HttpError } from './http-error';
export { HttpError };

/** For server components/pages: redirects to /login when signed out. */
export async function requirePageContext(minRole: Role = 'VIEWER') {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');
  const ctx = await loadContext(session.user.id, session.user.orgId, session.user.issuedAt);
  if (!ctx) redirect('/login');
  if (RANK[ctx.role] < RANK[minRole]) redirect('/app');
  return ctx;
}

/** For route handlers: throws HttpError (use withApi()). */
export async function requireApiContext(opts: { minRole?: Role; feature?: Feature; write?: boolean } = {}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new HttpError(401, 'Sign in required');
  const ctx = await loadContext(session.user.id, session.user.orgId, session.user.issuedAt);
  if (!ctx) throw new HttpError(401, 'Sign in required');
  if (RANK[ctx.role] < RANK[opts.minRole ?? 'VIEWER']) throw new HttpError(403, 'Your role does not allow this');
  if (opts.feature && !hasFeature(ctx.org, opts.feature)) {
    if (planIncludes(ctx.org, opts.feature)) throw new HttpError(403, 'Onboarding is turned off for your company. An admin can turn it on in Settings & data.');
    throw new HttpError(402, 'This feature is not included in your plan');
  }
  if (opts.write && !['trialing', 'active'].includes(ctx.org.subscriptionStatus)) throw new HttpError(402, 'Your subscription is inactive. Update billing to make changes.');
  return ctx;
}

async function loadContext(userId: string, orgId: string, issuedAt?: number) {
  const m = await db.membership.findUnique({ where: { userId_organizationId: { userId, organizationId: orgId } }, include: { organization: true, user: true } });
  if (!m) return null;
  // A password reset signs out every session issued before it (issuedAt is the JWT's iat, in seconds).
  if (m.user.passwordChangedAt && (!issuedAt || issuedAt * 1000 < m.user.passwordChangedAt.getTime() - 1000)) return null;
  return { user: m.user, org: m.organization, role: m.role, tdb: tenantDb(orgId) };
}

export function withApi<T extends unknown[]>(fn: (...args: T) => Promise<Response>) {
  return async (...args: T) => {
    try { return await fn(...args); }
    catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return Response.json({ error: 'That record already exists' }, { status: 409 });
      if (e && typeof e === 'object' && 'issues' in e) return Response.json({ error: 'Invalid input', issues: (e as { issues: unknown }).issues }, { status: 400 });
      const r = args[0] instanceof Request ? args[0] : null;
      await captureError(e, { route: r ? cleanPath(r.url) : undefined, method: r?.method });
      return Response.json({ error: 'Something went wrong' }, { status: 500 });
    }
  };
}

export async function logActivity(orgId: string, text: string, actorId?: string) {
  await db.activity.create({ data: { organizationId: orgId, text, actorId } });
}

/** Whether the signed-in user may make changes (role above viewer and an active subscription). */
export const canEdit = (ctx: { role: Role; org: { subscriptionStatus: string } }) =>
  ctx.role !== 'VIEWER' && ['trialing', 'active'].includes(ctx.org.subscriptionStatus);
