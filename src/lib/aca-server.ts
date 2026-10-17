import { z } from 'zod';
import { Prisma, type Organization, type User } from '@prisma/client';
import { HttpError, logActivity, type TenantDb } from './tenant';
import { audit } from './audit';
import { toCsv } from './csv';
import {
  COVERAGE, DEFAULT_POLICY, addDays, addMonths, aleTest, evaluate, form1095Month, initialCycle, monthStart, needs1095, policyProblems, standardCycle, sundays,
  type AcaPolicy, type Coverage, type Evaluation, type Offer, type Week,
} from './aca';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
export const todayYmd = () => ymd(new Date());

export async function getPolicy(tdb: TenantDb): Promise<AcaPolicy & { saved: boolean }> {
  const p = await tdb.acaPolicy.findFirst();
  return p ? { measurementMonths: p.measurementMonths, adminMonths: p.adminMonths, stabilityMonths: p.stabilityMonths, startMonth: p.startMonth, saved: true } : { ...DEFAULT_POLICY, saved: false };
}

export const PolicyBody = z.object({ measurementMonths: z.number().int(), adminMonths: z.number().int(), stabilityMonths: z.number().int(), startMonth: z.number().int() });
export async function savePolicy(tdb: TenantDb, org: Organization, user: User, b: AcaPolicy) {
  const problems = policyProblems(b);
  if (problems.length) throw new HttpError(400, problems[0]);
  const had = await tdb.acaPolicy.findFirst();
  if (had) await tdb.acaPolicy.updateMany({ where: { id: had.id }, data: { ...b, updatedById: user.id } });
  else await tdb.acaPolicy.create({ data: { ...b, updatedById: user.id } as never });
  await audit(org.id, user, 'aca.policy', `Changed ACA measurement settings: ${b.measurementMonths}-month measurement, ${b.adminMonths}-month administrative, ${b.stabilityMonths}-month stability periods, starting each ${MONTHS[b.startMonth - 1]}`, { targetType: 'acaPolicy', targetId: org.id });
}
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Hours of service per person per week since `from`: approved or paid timesheets (worked plus paid leave), and for
 * salaried employees 40 hours for each week they were employed (the weekly equivalency allowed for non-hourly staff).
 */
export async function hoursByPerson(tdb: TenantDb, from: string, to: string) {
  const [sheets, salaried] = await Promise.all([
    tdb.timesheet.findMany({ where: { status: { in: ['APPROVED', 'PAID'] }, weekEnding: { gte: day(from), lte: day(to) } }, select: { weekEnding: true, regularHours: true, overtimeHours: true, leaveHours: true, application: { select: { candidateId: true } } } }),
    tdb.employee.findMany({ where: { payType: 'SALARY', startDate: { lte: day(to) }, OR: [{ endDate: null }, { endDate: { gte: day(from) } }] }, select: { candidateId: true, startDate: true, endDate: true } }),
  ]);
  const by = new Map<string, Map<string, number>>();
  const add = (id: string, week: string, h: number) => { const m = by.get(id) ?? new Map<string, number>(); m.set(week, (m.get(week) ?? 0) + h); by.set(id, m); };
  for (const t of sheets) add(t.application.candidateId, ymd(t.weekEnding), Number(t.regularHours) + Number(t.overtimeHours) + Number(t.leaveHours));
  for (const e of salaried) {
    const s = ymd(e.startDate) > from ? ymd(e.startDate) : from, end = e.endDate && ymd(e.endDate) < to ? ymd(e.endDate) : to;
    for (const w of sundays({ start: s, end: addDays(end, 6) })) if (w <= to && !by.get(e.candidateId)?.has(w)) add(e.candidateId, w, 40);
  }
  return new Map([...by].map(([id, m]) => [id, [...m].map(([weekEnding, hours]) => ({ weekEnding, hours })).sort((a, b) => a.weekEnding.localeCompare(b.weekEnding)) as Week[]]));
}

type OfferRow = Prisma.AcaOfferGetPayload<object>;
const toOffer = (o: OfferRow): Offer & { id: string; offeredOn: string; respondedOn: string | null; note: string | null } => ({
  id: o.id, offeredOn: ymd(o.offeredOn), coverageStart: ymd(o.coverageStart), coverageEnd: o.coverageEnd ? ymd(o.coverageEnd) : null, coverage: o.coverage as Coverage,
  minimumValue: o.minimumValue, employeeCost: Number(o.employeeCost), response: o.response as Offer['response'], respondedOn: o.respondedOn ? ymd(o.respondedOn) : null, note: o.note,
});
const covers = (o: Offer, month: string) => o.coverageStart <= addDays(addMonths(month, 1), -1) && (!o.coverageEnd || o.coverageEnd >= month);

export type PersonRow = {
  candidateId: string; name: string; kind: Evaluation['kind']; start: string | null;
  now: Evaluation['months'][string] | null; fullTimeThrough: string | null;
  current: Evaluation['current']; offer: ReturnType<typeof toOffer> | null;
  action: 'offer_now' | 'offer_soon' | 'watch' | null; actionText: string | null; offerBy: string | null;
};

/** Everyone with hours in the last three years, their ACA status this month, and what to do about it. */
export async function overview(tdb: TenantDb, today = todayYmd()) {
  const policy = await getPolicy(tdb);
  const from = addMonths(today, -36), month = monthStart(today);
  const hours = await hoursByPerson(tdb, from, today);
  const ids = [...hours.keys()];
  const [people, offers] = await Promise.all([
    tdb.candidate.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    tdb.acaOffer.findMany({ where: { candidateId: { in: ids } }, orderBy: { coverageStart: 'desc' } }),
  ]);
  const rows: PersonRow[] = people.map((c) => {
    const weeks = hours.get(c.id) ?? [];
    const ev = evaluate(policy, weeks, addMonths(month, -1), addMonths(month, 12), today);
    const now = ev.months[month.slice(0, 7)] ?? null;
    const mine = offers.filter((o) => o.candidateId === c.id).map(toOffer);
    const offer = mine.find((o) => covers(o, month)) ?? mine[0] ?? null;
    // How long the current full-time stretch runs.
    let fullTimeThrough: string | null = null;
    for (let m = month; ev.months[m.slice(0, 7)]?.status === 'full_time'; m = addMonths(m, 1)) fullTimeThrough = addDays(addMonths(m, 1), -1);
    let action: PersonRow['action'] = null, actionText: string | null = null, offerBy: string | null = null;
    if (now?.status === 'full_time' && !mine.some((o) => covers(o, month))) { action = 'offer_now'; actionText = 'Full-time this month with no offer of coverage on record.'; }
    else if (ev.current && ev.current.projected !== 'part_time' && ev.start) {
      // When a full-time result would start: the stability period after the measurement period running now.
      const init = initialCycle(policy, ev.start);
      offerBy = ev.current.label === 'Initial measurement' ? init.stability.start : nextStability(policy, ev.current.period.start);
      if (!mine.some((o) => covers(o, offerBy!))) {
        action = ev.current.projected === 'full_time' ? 'offer_soon' : 'watch';
        actionText = ev.current.projected === 'full_time'
          ? `Averaging ${ev.current.average.toFixed(1)} hours a week. If that holds, offer coverage starting ${offerBy}.`
          : `Averaging ${ev.current.average.toFixed(1)} hours a week, close to 30. Over 30 for the period means offering coverage from ${offerBy}.`;
      }
    }
    return { candidateId: c.id, name: c.name, kind: ev.kind, start: ev.start, now, fullTimeThrough, current: ev.current, offer, action, actionText, offerBy };
  });
  const order = { offer_now: 0, offer_soon: 1, watch: 2 } as const;
  rows.sort((a, b) => (a.action ? order[a.action] : 3) - (b.action ? order[b.action] : 3) || a.name.localeCompare(b.name));
  const year = +today.slice(0, 4);
  const c = [standardCycle(policy, year - 1), standardCycle(policy, year)];
  return {
    policy, today, rows, ale: aleTest([...hours.values()], year),
    cycles: { running: c.find((x) => x.measurement.start <= today && x.measurement.end >= today) ?? c[1], stable: [standardCycle(policy, year - 2), ...c].find((x) => x.stability.start <= today && x.stability.end >= today) ?? null },
    counts: { offerNow: rows.filter((r) => r.action === 'offer_now').length, offerSoon: rows.filter((r) => r.action === 'offer_soon').length, watch: rows.filter((r) => r.action === 'watch').length, fullTime: rows.filter((r) => r.now?.status === 'full_time').length },
  };
}
function nextStability(p: AcaPolicy, measurementStart: string) {
  return standardCycle(p, +measurementStart.slice(0, 4)).measurement.start === measurementStart ? standardCycle(p, +measurementStart.slice(0, 4)).stability.start : standardCycle(p, +measurementStart.slice(0, 4) - 1).stability.start;
}

// ---- offers ----
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date.');
export const OfferBody = z.object({
  candidateId: z.string().min(1),
  offeredOn: Day,
  coverageStart: Day,
  coverageEnd: Day.optional().nullable(),
  coverage: z.enum(Object.keys(COVERAGE) as [Coverage], { errorMap: () => ({ message: 'Choose who the coverage was offered to.' }) }),
  minimumValue: z.boolean(),
  employeeCost: z.number({ invalid_type_error: 'Enter the employee’s monthly cost.' }).min(0, 'The cost can’t be negative.').max(5000),
  response: z.enum(['PENDING', 'ACCEPTED', 'WAIVED']).default('PENDING'),
  note: z.string().trim().max(500).optional().nullable(),
}).refine((b) => !b.coverageEnd || b.coverageEnd >= b.coverageStart, { message: 'Coverage can’t end before it starts.', path: ['coverageEnd'] })
  .refine((b) => b.coverageStart.endsWith('-01'), { message: 'Coverage starts on the 1st of a month.', path: ['coverageStart'] });

export async function recordOffer(tdb: TenantDb, org: Organization, user: User, b: z.infer<typeof OfferBody>) {
  const c = await tdb.candidate.findFirst({ where: { id: b.candidateId }, select: { name: true } });
  if (!c) throw new HttpError(404, 'That person was deleted.');
  const o = await tdb.acaOffer.create({ data: {
    candidateId: b.candidateId, offeredOn: day(b.offeredOn), coverageStart: day(b.coverageStart), coverageEnd: b.coverageEnd ? day(b.coverageEnd) : null, coverage: b.coverage,
    minimumValue: b.minimumValue, employeeCost: new Prisma.Decimal(b.employeeCost), response: b.response, respondedOn: b.response === 'PENDING' ? null : day(b.offeredOn), note: b.note || null, createdById: user.id,
  } as never });
  const text = `Recorded an offer of health coverage to ${c.name} from ${b.coverageStart} (${COVERAGE[b.coverage].toLowerCase()}, $${b.employeeCost.toFixed(2)}/month)`;
  await logActivity(org.id, text, user.id);
  await audit(org.id, user, 'aca.offer', text, { targetType: 'acaOffer', targetId: o.id });
  return o.id;
}

export const ResponseBody = z.object({ response: z.enum(['PENDING', 'ACCEPTED', 'WAIVED']), respondedOn: Day.optional() });
export async function setResponse(tdb: TenantDb, org: Organization, user: User, id: string, b: z.infer<typeof ResponseBody>) {
  const o = await tdb.acaOffer.findFirst({ where: { id }, include: { candidate: { select: { name: true } } } });
  if (!o) throw new HttpError(404, 'That offer was deleted.');
  await tdb.acaOffer.updateMany({ where: { id }, data: { response: b.response, respondedOn: b.response === 'PENDING' ? null : day(b.respondedOn ?? todayYmd()) } });
  await audit(org.id, user, 'aca.offer', `${o.candidate.name} ${b.response === 'ACCEPTED' ? 'accepted' : b.response === 'WAIVED' ? 'declined' : 'hasn’t answered'} the offer of coverage from ${ymd(o.coverageStart)}`, { targetType: 'acaOffer', targetId: id });
}

// ---- Form 1095-C data ----
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Suggested Form 1095-C lines 14–16 for each month of `year`, for everyone who needs a form. For a filing service or
 * payroll provider to check and complete (SSNs and addresses aren't kept here, and safe-harbor codes depend on wages).
 */
export async function form1095Csv(tdb: TenantDb, year: number, today = todayYmd()) {
  const policy = await getPolicy(tdb);
  const end = `${year}-12-31` < today ? `${year}-12-31` : today;
  const hours = await hoursByPerson(tdb, `${year - 3}-01-01`, end);
  const ids = [...hours.keys()];
  const [people, offers] = await Promise.all([
    tdb.candidate.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, payrollId: true }, orderBy: { name: 'asc' } }),
    tdb.acaOffer.findMany({ where: { candidateId: { in: ids } } }),
  ]);
  const head = ['Employee', 'Employee ID', ...MON.flatMap((m) => [`${m} line 14`, `${m} line 15`, `${m} line 16`])];
  const rows: string[][] = [];
  for (const c of people) {
    const mine = offers.filter((o) => o.candidateId === c.id).map(toOffer);
    const ev = evaluate(policy, hours.get(c.id) ?? [], `${year}-01-01`, `${year}-12-01`, addDays(end, 1));
    if (!needs1095(ev, mine, year)) continue;
    rows.push([c.name, c.payrollId ?? '', ...MON.flatMap((_, i) => {
      const key = `${year}-${String(i + 1).padStart(2, '0')}`;
      const f = form1095Month(key, ev.months[key]?.status ?? 'not_employed', mine);
      return [f.line14, f.line15, f.line16];
    })]);
  }
  return { csv: toCsv([head, ...rows]) + '\r\n', people: rows.length };
}
