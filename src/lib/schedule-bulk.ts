import { z } from 'zod';
import type { Organization, Role, User } from '@prisma/client';
import { HttpError, logActivity, type TenantDb } from './tenant';
import { hasFeature } from './plans';
import { ShiftFields, assignmentWhere, checkTimes, parse, shiftWarnings } from './schedule-server';
import { WEEK_HOURS_BEFORE_OT, addDays, dayLabel, clock, overlaps, shiftHours, weekDays, type ShiftTimes } from './schedule';
import { shiftRuleWarnings, NOTICE_DAYS } from './state-rules';
import { localDate } from './timeclock';
import { onboardingGaps } from './onboarding-server';
import { barredFrom } from './dnr';
import { certGaps, enforceCerts } from './training-server';
import { onLeave } from './leave-check';

/**
 * Many shifts at once: the "Create schedule" builder (plan, then create) and bulk edit, move and cancel on the board.
 * Every rule the single-shift routes apply still applies; the difference is that a whole batch is checked first,
 * so nothing is created or changed unless all of it can be.
 */
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.');
const weekOf = (d: string) => { const x = day(d); x.setUTCDate(x.getUTCDate() + ((7 - x.getUTCDay()) % 7)); return ymd(x); };
type Ctx = { tdb: TenantDb; org: Organization; user: User; role: Role };

export const PlanBody = z.object({
  applicationIds: z.array(z.string()).min(1, 'Choose at least one worker.').max(100, 'Schedule up to 100 workers at a time.'),
  dates: z.array(DATE).min(1, 'Choose at least one day.').max(31, 'Add up to 31 days at a time.'),
  ...ShiftFields,
  override: z.string().max(500).optional(),
});
export type PlanItem = { applicationId: string; worker: string; job: string; dates: string[]; hours: number; weekHours: number; blocked: string | null; certGaps: string[]; warnings: string[] };

/** Several predictive-scheduling warnings become one line. */
function collapse(warnings: string[]) {
  const notice = warnings.filter((w) => w.includes('predictive scheduling'));
  const rest = [...new Set(warnings.filter((w) => !w.includes('predictive scheduling')))];
  if (notice.length === 1) rest.push(notice[0]);
  else if (notice.length) rest.push(`${notice[0].split(':')[0]}: ${notice.length} of these shifts are less than ${NOTICE_DAYS} days out. If the law covers this job, changes may owe predictability pay.`);
  return rest;
}

/** Existing (not cancelled) shifts for these workers over the whole weeks the dates fall in, plus a day either side for overlaps. */
async function existingFor(tdb: TenantDb, candidateIds: string[], dates: string[], excludeIds: string[] = []) {
  const weeks = [...new Set(dates.map(weekOf))].sort();
  return tdb.shift.findMany({
    where: { cancelled: false, application: { candidateId: { in: candidateIds } }, date: { gte: day(addDays(weekDays(weeks[0])[0], -1)), lte: day(addDays(weeks[weeks.length - 1], 1)) }, ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}) },
    select: { id: true, date: true, start: true, end: true, breakMinutes: true, application: { select: { candidateId: true, job: { select: { title: true } } } } },
  });
}
type Existing = Awaited<ReturnType<typeof existingFor>>;
const times = (e: Existing[number]): ShiftTimes => ({ date: ymd(e.date), start: e.start, end: e.end, breakMinutes: e.breakMinutes });

/** Overtime for each week the new shifts land in, counting the worker's other shifts that week. */
function overtimeWarnings(existing: Existing, candidateId: string, planned: ShiftTimes[]) {
  const out: string[] = [];
  for (const w of [...new Set(planned.map((p) => weekOf(p.date)))]) {
    const ds = weekDays(w);
    const h = existing.filter((e) => e.application.candidateId === candidateId && ds.includes(ymd(e.date))).reduce((t, e) => t + shiftHours(times(e)), 0)
      + planned.filter((p) => ds.includes(p.date)).reduce((t, p) => t + shiftHours(p), 0);
    if (h > WEEK_HOURS_BEFORE_OT) out.push(`${+h.toFixed(2)} hours the week ending ${dayLabel(w, { month: 'short', day: 'numeric' })} — ${+(h - WEEK_HOURS_BEFORE_OT).toFixed(2)} over ${WEEK_HOURS_BEFORE_OT} are overtime (1.5×).`);
  }
  return out;
}

/** Checks a batch without saving anything: who can't be scheduled and why, missing certifications, and warnings. */
export async function planShifts(ctx: Ctx, body: unknown) {
  const b = parse(PlanBody, body);
  checkTimes(b);
  const { tdb, org } = ctx;
  const dates = [...new Set(b.dates)].sort();
  const today = localDate(new Date(), org.timezone);
  const apps = await tdb.application.findMany({ where: { id: { in: b.applicationIds }, ...assignmentWhere },
    include: { candidate: { select: { id: true, name: true } }, job: { select: { id: true, title: true, location: true, requiredCerts: true, clientId: true, client: { select: { name: true } } } } } });
  const existing = await existingFor(tdb, apps.map((a) => a.candidateId), dates);
  const block = hasFeature(org, 'onboarding') && org.onboardingEnforcement === 'block';
  const features = { credentials: hasFeature(org, 'credentials'), onboarding: hasFeature(org, 'onboarding') };
  const plannedBy = new Map<string, ShiftTimes[]>(); // the same person can be on two assignments in one batch
  const items: PlanItem[] = [];
  for (const id of b.applicationIds) {
    const a = apps.find((x) => x.id === id);
    if (!a) { items.push({ applicationId: id, worker: 'Unknown', job: '', dates, hours: 0, weekHours: 0, blocked: 'No longer on this assignment.', certGaps: [], warnings: [] }); continue; }
    const planned = dates.map((date) => ({ date, start: b.start, end: b.end, breakMinutes: b.breakMinutes }));
    let blocked: string | null = null;
    const dnr = await barredFrom(tdb, a.candidateId, a.job.clientId);
    if (dnr) blocked = `On ${dnr.clientId ? `${a.job.client?.name ?? 'this client'}’s` : 'the company-wide'} do-not-return list.`;
    else if (block && (await onboardingGaps(tdb, a.candidateId))) blocked = 'Onboarding isn’t finished.';
    const off = blocked ? null : await onLeave(tdb, a.candidateId, dates);
    if (off) blocked = `On approved time off (${off.policy}) ${dayLabel(off.date)}.`;
    else if (!blocked) {
      const mine = [...existing.filter((e) => e.application.candidateId === a.candidateId).map((e) => ({ t: times(e), label: `${dayLabel(ymd(e.date))} ${clock(e.start)}–${clock(e.end)} (${e.application.job.title})` })),
        ...(plannedBy.get(a.candidateId) ?? []).map((t) => ({ t, label: `${dayLabel(t.date)} ${clock(t.start)}–${clock(t.end)} in this schedule` }))];
      const hit = planned.map((p) => mine.find((m) => overlaps(p, m.t))).find(Boolean);
      if (hit) blocked = `Already working ${hit.label}.`;
      else if (planned.some((p, i) => planned.some((q, j) => i < j && overlaps(p, q)))) blocked = 'Two of these shifts overlap (an overnight shift runs into the next one).';
    }
    const gaps = !blocked && hasFeature(org, 'training') && a.job.requiredCerts.length ? await certGaps(tdb, a.candidateId, a.job.requiredCerts, dates[dates.length - 1], today) : [];
    const ot = overtimeWarnings(existing, a.candidateId, [...planned, ...(plannedBy.get(a.candidateId) ?? [])]);
    const other = blocked ? [] : (await shiftWarnings(tdb, features, a.candidateId, dates)).filter((w) => !w.includes('overtime (1.5×)'));
    const rules = dates.flatMap((date) => shiftRuleWarnings(a.job, { date, hours: shiftHours(b), breakMinutes: b.breakMinutes }, today));
    const ds = new Set(dates.flatMap((d) => weekDays(weekOf(d))));
    items.push({
      applicationId: a.id, worker: a.candidate.name, job: [a.job.title, a.job.client?.name].filter(Boolean).join(' — '), dates, hours: +(shiftHours(b) * dates.length).toFixed(2),
      weekHours: +(existing.filter((e) => e.application.candidateId === a.candidateId && ds.has(ymd(e.date))).reduce((t, e) => t + shiftHours(times(e)), 0) + shiftHours(b) * dates.length).toFixed(2),
      blocked, certGaps: gaps, warnings: blocked ? [] : collapse([...ot, ...other, ...rules]),
    });
    if (!blocked) plannedBy.set(a.candidateId, [...(plannedBy.get(a.candidateId) ?? []), ...planned]);
  }
  return { items, fields: b };
}

/** Creates every shift in the batch, or none: blocked workers or unapproved missing certifications stop it. */
export async function createPlanned(ctx: Ctx, body: unknown) {
  const { items, fields: b } = await planShifts(ctx, body);
  const blocked = items.filter((i) => i.blocked);
  if (blocked.length) throw new HttpError(409, `Remove ${blocked.length === 1 ? 'this worker' : 'these workers'} first — ${blocked.map((i) => `${i.worker}: ${i.blocked}`).join(' ')}`);
  const gaps = items.filter((i) => i.certGaps.length);
  if (gaps.length) {
    const can = ctx.role === 'OWNER' || ctx.role === 'ADMIN';
    if (!b.override?.trim()) throw new HttpError(409, `Not certified for the job — ${gaps.map((i) => `${i.worker}: ${i.certGaps.join('; ')}`).join(' ')}. ${can ? 'Give a reason to continue anyway.' : 'Assign training on the Training page, or ask an owner or admin to override.'}`, { certOverride: true, canOverride: can });
    const apps = await ctx.tdb.application.findMany({ where: { id: { in: gaps.map((g) => g.applicationId) } }, include: { candidate: { select: { id: true, name: true } }, job: { select: { id: true, title: true, requiredCerts: true } } } });
    for (const a of apps) await enforceCerts(ctx, a.candidate, a.job, 'schedule', items[0].dates[items[0].dates.length - 1], b.override);
  }
  const apps = await ctx.tdb.application.findMany({ where: { id: { in: items.map((i) => i.applicationId) } }, select: { id: true } });
  const data = apps.flatMap((a) => items.find((i) => i.applicationId === a.id)!.dates.map((date) => ({
    organizationId: ctx.org.id, applicationId: a.id, date: day(date), start: b.start, end: b.end, breakMinutes: b.breakMinutes, unit: b.unit ?? null, notes: b.notes ?? null,
  })));
  await ctx.tdb.shift.createMany({ data });
  await logActivity(ctx.org.id, `Scheduled ${data.length} shift${data.length === 1 ? '' : 's'} for ${items.length} worker${items.length === 1 ? '' : 's'} (${clock(b.start)}–${clock(b.end)})`, ctx.user.id);
  return { created: data.length, warnings: items.flatMap((i) => i.warnings.map((w) => `${i.worker}: ${w}`)) };
}

export const BulkUpdateBody = z.object({
  ids: z.array(z.string()).min(1, 'Select at least one shift.').max(200, 'Change up to 200 shifts at a time.'),
  change: z.object({
    start: ShiftFields.start.optional(), end: ShiftFields.end.optional(), breakMinutes: ShiftFields.breakMinutes.optional(),
    unit: ShiftFields.unit, notes: ShiftFields.notes,
    moveDays: z.number().int().min(-6, 'Move up to 6 days at a time.').max(6, 'Move up to 6 days at a time.').optional(),
    date: DATE.optional(), applicationId: z.string().optional(),
  }),
  override: z.string().max(500).optional(),
});

/**
 * Changes times, moves to another day or another worker, for many shifts at once. Shifts a worker was already told
 * about are re-sent with the next publish; moving one to a different worker cancels it for the first worker.
 */
export async function bulkUpdate(ctx: Ctx, body: unknown) {
  const { ids, change: c, override } = parse(BulkUpdateBody, body);
  const { tdb, org } = ctx;
  const shifts = await tdb.shift.findMany({ where: { id: { in: ids } }, include: { application: { include: { candidate: { select: { id: true, name: true } }, job: { select: { id: true, title: true, location: true, requiredCerts: true, clientId: true, client: { select: { name: true } } } } } } } });
  if (shifts.length !== new Set(ids).size) throw new HttpError(404, 'Some of those shifts were deleted. Reload the page.');
  if (shifts.some((s) => s.cancelled)) throw new HttpError(409, 'Cancelled shifts can’t be changed. Leave them out of the selection.');
  if (c.date && shifts.length > 1 && new Set(shifts.map((s) => ymd(s.date))).size > 1) throw new HttpError(400, 'Those shifts are on different days. Move them by a number of days instead.');
  const target = c.applicationId ? await tdb.application.findFirst({ where: { id: c.applicationId, ...assignmentWhere }, include: { candidate: { select: { id: true, name: true } }, job: { select: { id: true, title: true, location: true, requiredCerts: true, clientId: true, client: { select: { name: true } } } } } }) : null;
  if (c.applicationId && !target) throw new HttpError(404, 'That worker is no longer on assignment.');
  const today = localDate(new Date(), org.timezone);

  const next = shifts.map((s) => {
    const app = target && target.id !== s.applicationId ? target : s.application;
    const t = { date: c.date ?? (c.moveDays ? addDays(ymd(s.date), c.moveDays) : ymd(s.date)), start: c.start ?? s.start, end: c.end ?? s.end, breakMinutes: c.breakMinutes ?? s.breakMinutes };
    checkTimes(t);
    return { s, app, t, moved: app.id !== s.applicationId };
  });
  // Overlaps: against everyone's other shifts, and inside the batch.
  const existing = await existingFor(tdb, [...new Set(next.map((n) => n.app.candidateId))], next.map((n) => n.t.date), ids);
  for (const [i, n] of next.entries()) {
    const hit = existing.find((e) => e.application.candidateId === n.app.candidateId && overlaps(n.t, times(e)));
    if (hit) throw new HttpError(409, `${n.app.candidate.name} already works ${dayLabel(ymd(hit.date))} ${clock(hit.start)}–${clock(hit.end)} (${hit.application.job.title}).`);
    if (next.some((m, j) => j > i && m.app.candidateId === n.app.candidateId && overlaps(n.t, m.t))) throw new HttpError(409, `That would give ${n.app.candidate.name} two overlapping shifts.`);
  }
  for (const app of [...new Map(next.map((n) => [n.app.candidateId, n.app])).values()]) {
    const off = await onLeave(tdb, app.candidateId, next.filter((n) => n.app.candidateId === app.candidateId).map((n) => n.t.date));
    if (off) throw new HttpError(409, `${app.candidate.name} is on approved time off (${off.policy}) ${dayLabel(off.date)}.`);
  }
  // A new worker has to be allowed on the job.
  if (target && next.some((n) => n.moved)) {
    const d = await barredFrom(tdb, target.candidateId, target.job.clientId);
    if (d) throw new HttpError(409, `${target.candidate.name} is on ${d.clientId ? `${target.job.client?.name ?? 'this client'}’s` : 'the company-wide'} do-not-return list.`);
    if (hasFeature(org, 'onboarding') && org.onboardingEnforcement === 'block' && (await onboardingGaps(tdb, target.candidateId))) throw new HttpError(409, `${target.candidate.name} can’t be scheduled until onboarding is finished.`);
    await enforceCerts(ctx, target.candidate, target.job, 'schedule', next.map((n) => n.t.date).sort().pop()!, override);
  }

  let resend = 0;
  for (const n of next) {
    const fields = { date: day(n.t.date), start: n.t.start, end: n.t.end, breakMinutes: n.t.breakMinutes, ...(c.unit !== undefined ? { unit: c.unit } : {}), ...(c.notes !== undefined ? { notes: c.notes } : {}) };
    if (n.moved && n.s.notifiedAt) {
      // The first worker was told: their shift becomes a cancellation, and the new worker gets a fresh one.
      await tdb.shift.updateMany({ where: { id: n.s.id }, data: { cancelled: true, notified: false } });
      await tdb.shift.create({ data: { applicationId: n.app.id, ...fields, unit: c.unit !== undefined ? c.unit : n.s.unit, notes: c.notes !== undefined ? c.notes : n.s.notes } as never });
      resend++;
      continue;
    }
    const timesChanged = ymd(n.s.date) !== n.t.date || n.s.start !== n.t.start || n.s.end !== n.t.end || n.s.breakMinutes !== n.t.breakMinutes;
    const changed = n.moved || timesChanged || (c.unit !== undefined && c.unit !== n.s.unit) || (c.notes !== undefined && c.notes !== n.s.notes);
    if (!changed) continue;
    if (n.s.notifiedAt) resend++;
    await tdb.shift.updateMany({ where: { id: n.s.id }, data: {
      ...fields, ...(n.moved ? { applicationId: n.app.id } : {}),
      notified: false, remindedAt: null, ...(timesChanged || n.moved ? { response: 'PENDING' as const, respondedAt: null, declineReason: null } : {}),
    } });
  }
  const what = target && next.some((n) => n.moved) ? `to ${target.candidate.name}` : c.date || c.moveDays ? 'to new days' : 'times';
  await logActivity(org.id, `Changed ${next.length} shift${next.length === 1 ? '' : 's'} (${what})`, ctx.user.id);
  const features = { credentials: hasFeature(org, 'credentials'), onboarding: hasFeature(org, 'onboarding') };
  const warnings: string[] = [];
  if ((c.date || c.moveDays) && hasFeature(org, 'training')) {
    // Moving later can run past a certification's expiry: warn, as editing one shift does.
    for (const app of [...new Map(next.filter((n) => !n.moved).map((n) => [n.app.id, n.app])).values()]) {
      if (!app.job.requiredCerts.length) continue;
      const gaps = await certGaps(tdb, app.candidateId, app.job.requiredCerts, next.filter((n) => n.app.id === app.id).map((n) => n.t.date).sort().pop()!, today);
      warnings.push(...gaps.map((g) => `${app.candidate.name}: Not certified for this job — ${g}.`));
    }
  }
  for (const app of [...new Map(next.map((n) => [n.app.id, n.app])).values()]) {
    const dates = next.filter((n) => n.app.id === app.id).map((n) => n.t.date);
    const w = [...await shiftWarnings(tdb, features, app.candidateId, dates), ...next.filter((n) => n.app.id === app.id).flatMap((n) => shiftRuleWarnings(app.job, { date: n.t.date, hours: shiftHours(n.t), breakMinutes: n.t.breakMinutes }, today))];
    warnings.push(...collapse(w).map((x) => `${app.candidate.name}: ${x}`));
  }
  return { updated: next.length, needsNotice: resend, warnings };
}

export const BulkRemoveBody = z.object({ ids: z.array(z.string()).min(1, 'Select at least one shift.').max(200) });

/** Deletes shifts nobody was told about; the rest become cancellations sent with the next publish. */
export async function bulkRemove(ctx: Ctx, body: unknown) {
  const { ids } = parse(BulkRemoveBody, body);
  const shifts = await ctx.tdb.shift.findMany({ where: { id: { in: ids } }, select: { id: true, notifiedAt: true, cancelled: true, notified: true } });
  const del = shifts.filter((s) => !s.notifiedAt || (s.cancelled && s.notified)).map((s) => s.id);
  const cancel = shifts.filter((s) => !del.includes(s.id) && !s.cancelled).map((s) => s.id);
  if (del.length) await ctx.tdb.shift.deleteMany({ where: { id: { in: del } } });
  if (cancel.length) await ctx.tdb.shift.updateMany({ where: { id: { in: cancel } }, data: { cancelled: true, notified: false } });
  await logActivity(ctx.org.id, `Removed ${shifts.length} shift${shifts.length === 1 ? '' : 's'} (${del.length} deleted, ${cancel.length} cancelled)`, ctx.user.id);
  return { deleted: del.length, cancelled: cancel.length };
}
