import { z } from 'zod';
import { Prisma, type Organization, type Role, type User } from '@prisma/client';
import { db } from './db';
import { HttpError, type TenantDb } from './tenant';
import { audit } from './audit';
import { parsePlace } from './state-rules';

/**
 * The checklist for someone leaving: created when their employment is ended, from the company's template (or the
 * default one). The final paycheck task is dated by the state's final-pay rule where we know it.
 */
type Ctx = { tdb: TenantDb; org: Organization; user: User; role: Role };
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => ymd(new Date(day(s).getTime() + n * 864e5));

export type TemplateItem = { title: string; owner: string | null; days: number; finalPay?: boolean };
export const DEFAULT_TEMPLATE: TemplateItem[] = [
  { title: 'Final paycheck', owner: 'Payroll', days: 0, finalPay: true },
  { title: 'Approve the final timesheet', owner: 'Payroll', days: 0 },
  { title: 'Settle time-off balance (pay out if your policy or state requires it)', owner: 'Payroll', days: 0 },
  { title: 'Collect equipment, keys, uniform and badge', owner: 'Manager', days: 0 },
  { title: 'Turn off system and building access', owner: 'IT', days: 0 },
  { title: 'Exit interview', owner: 'HR', days: -1 },
  { title: 'Send benefits and COBRA information (if they had coverage)', owner: 'HR', days: 14 },
];
export const templateOf = (org: { offboardingTemplate: unknown }): TemplateItem[] => (Array.isArray(org.offboardingTemplate) && org.offboardingTemplate.length ? org.offboardingTemplate as TemplateItem[] : DEFAULT_TEMPLATE);

const VOLUNTARY = ['Resigned', 'Retired'];
/**
 * When the final paycheck is due, for states with a rule that isn't simply "the next regular payday".
 * General guidance as of 2026 — rules have exceptions (notice given, commissions, industry); review annually.
 */
const FINAL_PAY: Record<string, { name: string; fired: number | 'payday'; quit: number | 'payday'; note: string }> = {
  CA: { name: 'California', fired: 0, quit: 3, note: 'due on the last day if they were let go; within 72 hours if they quit without notice (on the last day with 72 hours’ notice). Accrued vacation must be paid out.' },
  CO: { name: 'Colorado', fired: 0, quit: 'payday', note: 'due immediately if they were let go; by the next regular payday if they quit. Earned vacation must be paid out.' },
  MA: { name: 'Massachusetts', fired: 0, quit: 'payday', note: 'due on the last day if they were let go; by the next regular payday if they quit. Earned vacation counts as wages.' },
  TX: { name: 'Texas', fired: 6, quit: 'payday', note: 'due within 6 days if they were let go; by the next regular payday if they quit.' },
  NY: { name: 'New York', fired: 'payday', quit: 'payday', note: 'due by the next regular payday.' },
  IL: { name: 'Illinois', fired: 'payday', quit: 'payday', note: 'due by the next regular payday, including earned vacation.' },
  WA: { name: 'Washington', fired: 'payday', quit: 'payday', note: 'due at the end of the pay period.' },
};
export function finalPayRule(location: string | null | undefined, lastDay: string, reason: string) {
  const { state } = parsePlace(location);
  const r = state ? FINAL_PAY[state] : null;
  const quit = VOLUNTARY.includes(reason);
  if (!r) return { due: addDays(lastDay, 7), text: 'Pay by your next regular payday unless your state requires sooner. Check your state’s final-paycheck rule.' };
  const when = quit ? r.quit : r.fired;
  return { due: when === 'payday' ? addDays(lastDay, 7) : addDays(lastDay, when), text: `${r.name}: the final paycheck is ${r.note} Check the rule for your situation.` };
}

/** Builds the checklist when employment is ended (once per departure). */
export async function createChecklist(tdb: TenantDb, org: Organization, employeeId: string, lastDay: string, reason: string) {
  const e = await tdb.employee.findFirst({ where: { id: employeeId }, include: { application: { select: { job: { select: { location: true } } } }, branch: { select: { city: true } } } });
  if (!e || (await tdb.offboardingTask.count({ where: { employeeId, doneAt: null } }))) return 0;
  const fp = finalPayRule(e.application?.job.location ?? e.branch?.city, lastDay, reason);
  // Hours left on paid, tracked time off: worth knowing before the final paycheck.
  const left = await tdb.leaveEntry.groupBy({ by: ['policyId'], where: { employeeId, policy: { paid: true, method: { not: 'NONE' } } }, _sum: { hours: true } });
  const names = left.length ? await tdb.leavePolicy.findMany({ where: { id: { in: left.map((l) => l.policyId) } }, select: { id: true, name: true } }) : [];
  const balances = left.filter((l) => Number(l._sum.hours) > 0).map((l) => `${names.find((n) => n.id === l.policyId)?.name}: ${Number(l._sum.hours)} hours left`).join(', ');
  const items = templateOf(org);
  await tdb.offboardingTask.createMany({ data: items.map((t, i) => ({
    organizationId: org.id, employeeId, title: t.title, owner: t.owner, sort: i,
    dueDate: day(t.finalPay ? fp.due : addDays(lastDay, t.days)),
    note: t.finalPay ? fp.text : /time-off balance/i.test(t.title) && balances ? balances : null,
  })) });
  return items.length;
}

export const TaskBody = z.object({ title: z.string().trim().min(1, 'Describe the task.').max(200), owner: z.string().trim().max(40).optional().nullable(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable() });
export const TaskUpdate = z.object({ done: z.boolean().optional(), note: z.string().trim().max(1000).optional().nullable() });
export const TemplateBody = z.object({ items: z.array(z.object({ title: z.string().trim().min(1, 'Every task needs a description.').max(200), owner: z.string().trim().max(40).nullable().optional(), days: z.coerce.number().int().min(-30).max(90).default(0), finalPay: z.boolean().optional() })).max(40) });

export async function addTask(ctx: Ctx, employeeId: string, body: unknown) {
  const r = TaskBody.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Describe the task.');
  const e = await ctx.tdb.employee.findFirst({ where: { id: employeeId } });
  if (!e) throw new HttpError(404, 'That employee was deleted.');
  const n = await ctx.tdb.offboardingTask.count({ where: { employeeId } });
  const t = await ctx.tdb.offboardingTask.create({ data: { employeeId, title: r.data.title, owner: r.data.owner || null, dueDate: r.data.dueDate ? day(r.data.dueDate) : e.endDate, sort: n } as never });
  return { id: t.id };
}

export async function updateTask(ctx: Ctx, id: string, body: unknown) {
  const r = TaskUpdate.safeParse(body);
  if (!r.success) throw new HttpError(400, 'Check the note and try again.');
  const t = await ctx.tdb.offboardingTask.findFirst({ where: { id } });
  if (!t) throw new HttpError(404, 'That task was deleted.');
  await ctx.tdb.offboardingTask.updateMany({ where: { id }, data: {
    ...(r.data.done !== undefined ? { doneAt: r.data.done ? new Date() : null, doneById: r.data.done ? ctx.user.id : null } : {}),
    ...(r.data.note !== undefined ? { note: r.data.note || null } : {}),
  } });
  return { ok: true };
}

export async function saveTemplate(ctx: Ctx, body: unknown) {
  const r = TemplateBody.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Check the checklist.');
  const items = r.data.items.map((i) => ({ title: i.title, owner: i.owner || null, days: i.days, ...(i.finalPay ? { finalPay: true } : {}) }));
  // An empty list goes back to the default checklist.
  await db.organization.update({ where: { id: ctx.org.id }, data: { offboardingTemplate: items.length ? items : Prisma.DbNull } });
  await audit(ctx.org.id, ctx.user, 'offboarding.template', `Saved the offboarding checklist (${items.length} task${items.length === 1 ? '' : 's'})`);
  return { ok: true };
}
