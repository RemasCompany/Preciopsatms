import type { Prisma } from '@prisma/client';
import { db } from './db';

/** Every action the audit log records, with how it's shown and filtered. */
export const AUDIT_ACTIONS = {
  'auth.login': { group: 'Sign-in', label: 'Signed in' },
  'auth.login_failed': { group: 'Sign-in', label: 'Failed sign-in' },
  'auth.password_reset': { group: 'Sign-in', label: 'Reset password' },
  'team.invite': { group: 'Team', label: 'Invited a teammate' },
  'team.invite_revoke': { group: 'Team', label: 'Revoked an invite' },
  'team.join': { group: 'Team', label: 'Joined the team' },
  'team.role_change': { group: 'Team', label: 'Changed a role' },
  'team.remove': { group: 'Team', label: 'Removed a teammate' },
  'settings.company': { group: 'Settings', label: 'Company settings' },
  'settings.payroll': { group: 'Settings', label: 'Payroll settings' },
  'settings.timeclock': { group: 'Settings', label: 'Time clock settings' },
  'settings.engagement': { group: 'Settings', label: 'Engagement settings' },
  'settings.onboarding': { group: 'Settings', label: 'Onboarding settings' },
  'billing.checkout': { group: 'Billing', label: 'Started a plan change' },
  'billing.portal': { group: 'Billing', label: 'Opened billing portal' },
  'data.export_all': { group: 'Data', label: 'Exported all company data' },
  'data.export': { group: 'Data', label: 'Exported records' },
  'data.import': { group: 'Data', label: 'Imported records' },
  'data.audit_export': { group: 'Data', label: 'Exported the audit log' },
  'eeo.report_view': { group: 'EEO', label: 'Viewed the EEO report' },
  'eeo.export': { group: 'EEO', label: 'Exported the applicant flow log' },
  'payroll.approve': { group: 'Payroll', label: 'Approved a payroll run' },
  'payroll.unapprove': { group: 'Payroll', label: 'Reopened a payroll run' },
  'payroll.pay': { group: 'Payroll', label: 'Marked a payroll run paid' },
  'payroll.void': { group: 'Payroll', label: 'Voided a payroll run' },
  'payroll.export': { group: 'Payroll', label: 'Exported a payroll run' },
} as const;
export type AuditAction = keyof typeof AUDIT_ACTIONS;
export const AUDIT_GROUPS = [...new Set(Object.values(AUDIT_ACTIONS).map((a) => a.group))];

type Actor = { id: string; email: string } | null;
type Opts = { targetType?: string; targetId?: string; changes?: Record<string, unknown>; req?: Request };

// Secrets never go in the log, even as "before/after".
const SECRET = /secret|token|password|key/i;

/** What changed between two versions of a settings object, as { field: [before, after] }. Secrets show as "(changed)". */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(after)) {
    const a = before[k] ?? null, b = after[k] ?? null;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    out[k] = SECRET.test(k) ? ['(hidden)', '(changed)'] : [a, b];
  }
  return out;
}

async function requestInfo(req?: Request) {
  let h: Headers | null = req?.headers ?? null;
  if (!h) {
    try { h = (await import('next/headers')).headers() as unknown as Headers; } catch { h = null; } // outside a request (jobs, tests)
  }
  if (!h) return { ip: null, userAgent: null };
  return { ip: (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? '').split(',')[0].trim().slice(0, 64) || null, userAgent: h.get('user-agent')?.slice(0, 300) ?? null };
}

/** Records an admin or security action. Never throws: a logging hiccup must not undo the action itself. */
export async function audit(orgId: string, actor: Actor, action: AuditAction, summary: string, opts: Opts = {}) {
  try {
    const { ip, userAgent } = await requestInfo(opts.req);
    await db.auditLog.create({ data: {
      organizationId: orgId, actorId: actor?.id ?? null, actorEmail: actor?.email ?? null, action, summary: summary.slice(0, 500),
      targetType: opts.targetType ?? null, targetId: opts.targetId ?? null,
      changes: opts.changes && Object.keys(opts.changes).length ? (opts.changes as Prisma.InputJsonValue) : undefined, ip, userAgent,
    } });
  } catch (e) {
    console.error('[audit] could not record', action, e);
  }
}

export type AuditFilter = { group?: string; actor?: string; from?: string; to?: string; before?: string };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Search filters from the query string (anything invalid is ignored). Dates are whole UTC days. */
export function auditWhere(f: AuditFilter): Prisma.AuditLogWhereInput {
  const actions = f.group && AUDIT_GROUPS.includes(f.group as never) ? Object.entries(AUDIT_ACTIONS).filter(([, a]) => a.group === f.group).map(([k]) => k) : null;
  const createdAt: Prisma.DateTimeFilter = {};
  if (f.from && DAY.test(f.from)) createdAt.gte = new Date(`${f.from}T00:00:00Z`);
  if (f.to && DAY.test(f.to)) createdAt.lt = new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 864e5);
  if (f.before && !Number.isNaN(Date.parse(f.before))) createdAt.lt = createdAt.lt && createdAt.lt < new Date(f.before) ? createdAt.lt : new Date(f.before);
  return {
    ...(actions ? { action: { in: actions } } : {}),
    ...(f.actor ? { actorEmail: f.actor.slice(0, 200) } : {}),
    ...(Object.keys(createdAt).length ? { createdAt } : {}),
  };
}

export const actionLabel = (a: string) => (AUDIT_ACTIONS as Record<string, { label: string }>)[a]?.label ?? a;

/** "field: before → after" lines for display and CSV. */
export function describeChanges(changes: unknown) {
  if (!changes || typeof changes !== 'object') return '';
  const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(empty)' : typeof v === 'string' ? v : JSON.stringify(v));
  return Object.entries(changes as Record<string, unknown>).map(([k, v]) => (Array.isArray(v) && v.length === 2 ? `${k}: ${show(v[0])} → ${show(v[1])}` : `${k}: ${show(v)}`)).join('; ');
}
