// HR internal audit: runs the automatic checks against the company's records and keeps each audit's answers.
import { z } from 'zod';
import type { Organization, Prisma, User } from '@prisma/client';
import { db } from './db';
import { HttpError, logActivity, type TenantDb } from './tenant';
import { audit } from './audit';
import { hasFeature } from './plans';
import { assignmentWhere } from './schedule-server';
import { i9Due } from './onboarding';
import { overview as acaOverview } from './aca-server';
import { CHECKS, EXEMPT_SALARY_YEARLY, FEDERAL_MIN_WAGE, auditCsv, checklistFor, i9RetainUntil, score, type Answers, type Finding, type FindingItem, type Reviews } from './hr-audit';

type Ctx = { org: Organization; user: User; tdb: TenantDb };
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const todayYmd = () => ymd(new Date());
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5);
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const done = (s: string) => s === 'DONE' || s === 'WAIVED';

/** Runs every check that applies to this company (by plan, company type and switched-on features). */
export async function runChecks(tdb: TenantDb, org: Organization, today = todayYmd()): Promise<Finding[]> {
  const people = hasFeature(org, 'people'), onboarding = hasFeature(org, 'onboarding');
  const out: Record<string, FindingItem[]> = {};
  const add = (key: keyof typeof CHECKS, item: FindingItem) => (out[key] ??= []).push(item);

  // Who's working now: active employees, and (for agencies) workers on assignment. One entry per person.
  const [emps, placements] = await Promise.all([
    people ? tdb.employee.findMany({ where: { status: { in: ['ACTIVE', 'ON_LEAVE'] } }, select: { id: true, candidateId: true, startDate: true, payType: true, payRate: true, emergencyPhone: true, candidate: { select: { name: true } } } }) : [],
    tdb.application.findMany({ where: assignmentWhere, select: { id: true, candidateId: true, stageChangedAt: true, candidate: { select: { name: true } }, job: { select: { title: true, payRate: true } }, employee: { select: { id: true } } } }),
  ]);
  const working = new Map<string, { name: string; start: string; href: string }>();
  for (const e of emps) working.set(e.candidateId, { name: e.candidate.name, start: ymd(e.startDate), href: `/app/employees/${e.id}` });
  for (const p of placements) if (!working.has(p.candidateId)) working.set(p.candidateId, { name: p.candidate.name, start: ymd(p.stageChangedAt ?? new Date()), href: `/app/candidates?open=${p.candidateId}` });
  const ids = [...working.keys()];

  // Paperwork from onboarding (staff tasks and uploads) and hiring documents.
  const [steps, docs, onboardings] = ids.length ? await Promise.all([
    tdb.onboardingStep.findMany({ where: { onboarding: { candidateId: { in: ids } } }, select: { kind: true, config: true, status: true, onboarding: { select: { candidateId: true } } } }),
    tdb.hiringDocument.findMany({ where: { candidateId: { in: ids }, kind: 'w4', status: { in: ['RECEIVED', 'ACCEPTED'] } }, select: { candidateId: true } }),
    onboarding ? tdb.onboarding.findMany({ where: { candidateId: { in: ids }, status: 'IN_PROGRESS', startDate: { lt: daysAgo(7) } }, select: { candidateId: true, startDate: true, packageName: true } }) : [],
  ]) : [[], [], []];
  const stepDone = (cid: string, match: (cfg: Record<string, unknown>, kind: string) => boolean) =>
    steps.some((s) => s.onboarding.candidateId === cid && done(s.status) && match((s.config ?? {}) as Record<string, unknown>, s.kind));
  const w4On = new Set(docs.map((d) => d.candidateId));
  for (const [cid, p] of working) {
    if (i9Due(p.start) < today && !stepDone(cid, (c, k) => k === 'STAFF' && c.task === 'i9'))
      add('i9_missing', { id: cid, name: p.name, detail: `Started ${fmt(p.start)}; Section 2 was due ${fmt(i9Due(p.start))}.` });
    if (p.start < today && !w4On.has(cid) && !stepDone(cid, (c, k) => (k === 'STAFF' && c.task === 'w4') || (k === 'UPLOAD' && c.docKind === 'w4')))
      add('w4_missing', { id: cid, name: p.name, detail: `Started ${fmt(p.start)}.` });
  }
  for (const o of onboardings) add('onboarding_stalled', { id: o.candidateId, name: working.get(o.candidateId)?.name ?? 'Unknown', detail: `${o.packageName}; started ${fmt(ymd(o.startDate!))}.` });

  // Pay.
  for (const e of emps) {
    const rate = Number(e.payRate);
    if (e.payType === 'HOURLY' && rate > 0 && rate < FEDERAL_MIN_WAGE) add('pay_below_minimum', { id: e.candidateId, name: e.candidate.name, detail: `${money(rate)}/hour.` });
    if (e.payType === 'SALARY' && rate > 0 && rate < EXEMPT_SALARY_YEARLY) add('exempt_below_threshold', { id: e.candidateId, name: e.candidate.name, detail: `${money(rate)}/year (${money(rate / 52)}/week).` });
  }
  for (const p of placements) {
    const rate = Number(p.job.payRate ?? 0);
    if (!p.employee && rate > 0 && rate < FEDERAL_MIN_WAGE) add('pay_below_minimum', { id: p.candidateId, name: p.candidate.name, detail: `${money(rate)}/hour on ${p.job.title}.` });
  }

  // E-Verify cases past their deadline.
  if (onboarding) for (const c of await tdb.eVerifyCase.findMany({ where: { status: 'to_create', dueDate: { lt: new Date(`${today}T00:00:00Z`) } }, select: { candidateId: true, dueDate: true, candidate: { select: { name: true } } } }))
    add('everify_overdue', { id: c.candidateId, name: c.candidate.name, detail: `The case was due ${fmt(ymd(c.dueDate))}.` });

  // Expired credentials: the newest of each type has expired.
  if (hasFeature(org, 'credentials') && ids.length) {
    const creds = await tdb.credential.findMany({ where: { candidateId: { in: ids } }, select: { candidateId: true, type: true, name: true, expiresAt: true }, orderBy: { expiresAt: 'desc' } });
    const latest = new Map<string, (typeof creds)[number]>();
    for (const c of creds) { const k = `${c.candidateId}|${c.type}|${c.name ?? ''}`; if (!latest.has(k)) latest.set(k, c); }
    for (const c of latest.values()) if (c.expiresAt && ymd(c.expiresAt) < today) add('credentials_expired', { id: c.candidateId, name: working.get(c.candidateId)!.name, detail: `${c.name ? `${c.type} (${c.name})` : c.type} expired ${fmt(ymd(c.expiresAt))}.` });
  }

  // ACA: full-time this month with no offer on record.
  if (hasFeature(org, 'aca')) for (const r of (await acaOverview(tdb, today)).rows) if (r.action === 'offer_now') add('aca_offer_due', { id: r.candidateId, name: r.name, detail: r.actionText ?? 'No offer of coverage on record.' });

  if (people) {
    const [tasks, former] = await Promise.all([
      tdb.offboardingTask.findMany({ where: { doneAt: null, dueDate: { lt: new Date(`${today}T00:00:00Z`) } }, select: { title: true, dueDate: true, employee: { select: { candidateId: true, candidate: { select: { name: true } } } } }, orderBy: { dueDate: 'asc' } }),
      tdb.employee.findMany({ where: { status: 'TERMINATED', endDate: { not: null } }, select: { candidateId: true, startDate: true, endDate: true, candidate: { select: { name: true } } } }),
    ]);
    for (const t of tasks) add('offboarding_overdue', { id: t.employee.candidateId, name: t.employee.candidate.name, detail: `${t.title} (due ${fmt(ymd(t.dueDate!))}).` });
    for (const e of emps) if (!e.emergencyPhone) add('emergency_contact_missing', { id: e.candidateId, name: e.candidate.name, detail: 'No emergency contact phone.' });
    for (const e of former) { const until = i9RetainUntil(ymd(e.startDate), ymd(e.endDate!)); if (until < today) add('i9_destroy', { id: e.candidateId, name: e.candidate.name, detail: `Keep until ${fmt(until)}; can be destroyed now.` }); }
  }
  if (hasFeature(org, 'reviews')) {
    const late = await tdb.review.findMany({ where: { managerSubmittedAt: null, cycle: { status: 'OPEN' } }, select: { dueDate: true, cycle: { select: { name: true, dueDate: true } }, employee: { select: { candidateId: true, candidate: { select: { name: true } } } } } });
    for (const r of late) { const due = ymd(r.dueDate ?? r.cycle.dueDate); if (due < today) add('reviews_overdue', { id: r.employee.candidateId, name: r.employee.candidate.name, detail: `${r.cycle.name}, due ${fmt(due)}.` }); }
  }
  if (hasFeature(org, 'timeoff')) for (const r of await tdb.leaveRequest.findMany({ where: { status: 'PENDING', createdAt: { lt: daysAgo(7) } }, select: { createdAt: true, startDate: true, employee: { select: { candidateId: true, candidate: { select: { name: true } } } } } }))
    add('timeoff_waiting', { id: r.employee.candidateId, name: r.employee.candidate.name, detail: `Asked ${fmt(ymd(r.createdAt))} for ${fmt(ymd(r.startDate))}.` });

  // Who can see everything: owners and admins should use two-step (or the company's single sign-on).
  const admins = await db.membership.findMany({ where: { organizationId: org.id, role: { in: org.ssoRequired ? ['OWNER'] : ['OWNER', 'ADMIN'] } }, select: { role: true, user: { select: { id: true, email: true, name: true, totpEnabledAt: true } } } });
  for (const m of admins) if (!m.user.totpEnabledAt) add('admin_no_two_step', { id: m.user.id, name: m.user.name ?? m.user.email, detail: `${m.role === 'OWNER' ? 'Owner' : 'Admin'} · ${m.user.email}` });

  // Which checks apply here, in catalog order.
  const applies: Record<string, boolean> = {
    everify_overdue: onboarding, onboarding_stalled: onboarding, credentials_expired: hasFeature(org, 'credentials'), aca_offer_due: hasFeature(org, 'aca'),
    exempt_below_threshold: people, offboarding_overdue: people, emergency_contact_missing: people, i9_destroy: people,
    reviews_overdue: hasFeature(org, 'reviews'), timeoff_waiting: hasFeature(org, 'timeoff'),
  };
  return Object.entries(CHECKS).filter(([k]) => applies[k] !== false).map(([key, c]) => ({ key, ...c, items: (out[key] ?? []).sort((a, b) => a.name.localeCompare(b.name)) }));
}

const view = (a: { id: string; title: string; status: string; findings: Prisma.JsonValue; answers: Prisma.JsonValue; reviews: Prisma.JsonValue; notes: string | null; score: number | null; startedAt: Date; completedAt: Date | null }, org: Organization) => {
  const findings = a.findings as unknown as Finding[], answers = a.answers as unknown as Answers, reviews = a.reviews as unknown as Reviews, items = checklistFor(org.kind);
  return { id: a.id, title: a.title, status: a.status, findings, answers, reviews, notes: a.notes, checklist: items, startedAt: a.startedAt.toISOString(), completedAt: a.completedAt?.toISOString() ?? null,
    score: a.score ?? score(findings, answers, reviews, items) };
};

export async function listAudits(tdb: TenantDb) {
  const rows = await tdb.hrAudit.findMany({ orderBy: { startedAt: 'desc' }, take: 50, select: { id: true, title: true, status: true, score: true, startedAt: true, completedAt: true } });
  return rows.map((r) => ({ ...r, startedAt: r.startedAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null }));
}

async function find(tdb: TenantDb, id: string) {
  const a = await tdb.hrAudit.findFirst({ where: { id } });
  if (!a) throw new HttpError(404, 'That audit was deleted.');
  return a;
}
const assertOpen = (a: { status: string }) => { if (a.status !== 'OPEN') throw new HttpError(409, 'This audit is completed, so it can’t be changed. Start a new one.'); };

export async function startAudit({ org, user, tdb }: Ctx, title?: string) {
  if (await tdb.hrAudit.count({ where: { status: 'OPEN' } })) throw new HttpError(409, 'An audit is already open. Finish it before starting another.');
  const name = title?.trim() || `HR audit · ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
  const a = await tdb.hrAudit.create({ data: { title: name, findings: (await runChecks(tdb, org)) as never, startedById: user.id } as never });
  await logActivity(org.id, `Started ${name}`, user.id);
  await audit(org.id, user, 'hr_audit.start', `Started ${name}`, { targetType: 'hr_audit', targetId: a.id });
  return a.id;
}

/** An audit; while it's open, the automatic checks are re-run so fixes show up straight away. */
export async function getAudit({ org, tdb }: Pick<Ctx, 'org' | 'tdb'>, id: string) {
  let a = await find(tdb, id);
  if (a.status === 'OPEN') {
    const findings = await runChecks(tdb, org);
    await tdb.hrAudit.updateMany({ where: { id }, data: { findings: findings as never } });
    a = { ...a, findings: findings as never };
  }
  return view(a, org);
}

export const UpdateBody = z.object({
  answer: z.object({ key: z.string().max(60), answer: z.enum(['yes', 'no', 'na']).nullable(), note: z.string().trim().max(1000).optional() }).optional(),
  review: z.object({ key: z.string().max(60), note: z.string().trim().max(1000).nullable().optional() }).optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
});

export async function updateAudit({ org, user, tdb }: Ctx, id: string, b: z.infer<typeof UpdateBody>) {
  const a = await find(tdb, id);
  assertOpen(a);
  const answers = { ...(a.answers as unknown as Answers) }, reviews = { ...(a.reviews as unknown as Reviews) };
  if (b.answer) {
    if (!checklistFor(org.kind).some((c) => c.key === b.answer!.key)) throw new HttpError(400, 'Unknown checklist item.');
    if (b.answer.answer) answers[b.answer.key] = { answer: b.answer.answer, ...(b.answer.note ? { note: b.answer.note } : {}) };
    else delete answers[b.answer.key];
  }
  if (b.review) {
    if (!(b.review.key in CHECKS)) throw new HttpError(400, 'Unknown check.');
    if (b.review.note) reviews[b.review.key] = { note: b.review.note, by: user.name ?? user.email, at: new Date().toISOString() };
    else if (b.review.note === null) delete reviews[b.review.key];
    else throw new HttpError(400, 'Say what you reviewed or decided, so the audit records why.');
  }
  await tdb.hrAudit.updateMany({ where: { id }, data: { answers: answers as never, reviews: reviews as never, ...(b.notes !== undefined ? { notes: b.notes } : {}) } });
  return getAudit({ org, tdb }, id);
}

/** Freezes the findings and the score. Every checklist item needs an answer first. */
export async function completeAudit({ org, user, tdb }: Ctx, id: string) {
  const a = await find(tdb, id);
  assertOpen(a);
  const items = checklistFor(org.kind), answers = a.answers as unknown as Answers;
  const missing = items.filter((c) => !answers[c.key]);
  if (missing.length) throw new HttpError(400, `Answer every checklist item first (${missing.length} left). Use “Not applicable” where one doesn’t apply.`);
  const findings = await runChecks(tdb, org);
  const s = score(findings, answers, a.reviews as unknown as Reviews, items);
  await tdb.hrAudit.updateMany({ where: { id }, data: { findings: findings as never, score: s, status: 'COMPLETED', completedAt: new Date(), completedById: user.id } });
  await logActivity(org.id, `Completed ${a.title} (score ${s})`, user.id);
  await audit(org.id, user, 'hr_audit.complete', `Completed ${a.title} with a score of ${s}`, { targetType: 'hr_audit', targetId: id });
  return getAudit({ org, tdb }, id);
}

/** Turns a finding into a task on the Tasks page, assigned to the admin, due in two weeks. Names stay out of the title. */
export async function taskFromFinding({ org, user, tdb }: Ctx, id: string, key: string) {
  const a = await getAudit({ org, tdb }, id);
  const f = a.findings.find((x) => x.key === key);
  if (!f || !f.items.length) throw new HttpError(404, 'Nothing to follow up on for that check.');
  const due = new Date(Date.now() + 14 * 864e5);
  const t = await tdb.task.create({ data: { title: `HR audit: ${f.title} (${f.items.length})`, dueAt: due, priority: f.severity === 'high' ? 'High' : 'Normal', related: a.title, assigneeId: user.id } as never });
  await logActivity(org.id, `Added a task from ${a.title}: ${f.title}`, user.id);
  return t.id;
}

export async function exportAudit({ org, user, tdb }: Ctx, id: string, req?: Request) {
  const a = await getAudit({ org, tdb }, id);
  await audit(org.id, user, 'hr_audit.export', `Exported ${a.title}`, { targetType: 'hr_audit', targetId: id, req });
  return { name: `${a.title.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-')}.csv`, csv: auditCsv(a, a.findings, a.answers, a.reviews, a.checklist) };
}
