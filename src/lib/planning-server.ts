import type { Organization } from '@prisma/client';
import type { TenantDb } from './tenant';
import { localDate } from './timeclock';
import { shiftHours } from './schedule';
import { cents } from './invoicing';
import { OT_MULTIPLIER } from './weeks';
import { addDays, capacity, forecast, hiringPlan, monthly, weekOf, weekly, yearToDate, type WeekRow } from './planning';

/** How the planning page slices the workforce. Departments are for companies' own employees; clients for staffing firms. */
export const GROUPS = { all: 'Everyone', department: 'Department', location: 'Location', client: 'Client', position: 'Position' } as const;
export type Group = keyof typeof GROUPS;
export const groupsFor = (kind: string): Group[] => (kind === 'EMPLOYER' ? ['all', 'department', 'location', 'position'] : ['all', 'client', 'location', 'position']);

type Job = { title: string; branch: { name: string } | null; client: { name: string } | null };
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

/**
 * Everything the planning page needs for one company (and branch): weekly hours, cost and billing from approved
 * timesheets since the start of last year, shifts already scheduled ahead, typical time to fill, and open requisitions.
 */
export async function loadPlanning(tdb: TenantDb, org: Organization, opts: { year?: number; group?: Group; branchId?: string | null; now?: Date } = {}) {
  const now = opts.now ?? new Date(), today = localDate(now, org.timezone);
  const group = opts.group && groupsFor(org.kind).includes(opts.group) ? opts.group : 'all';
  const thisYear = Number(today.slice(0, 4)), year = opts.year && opts.year <= thisYear && opts.year >= thisYear - 5 ? opts.year : thisYear;
  const lastWeek = addDays(weekOf(today), -7); // the last complete week
  const through = year === thisYear ? lastWeek : `${year}-12-31`;
  const from = `${year - 1}-01-01`, to = year === thisYear ? lastWeek : `${year}-12-31`;
  const inBranch = opts.branchId ? { branchId: opts.branchId } : {};
  const jobSel = { title: true, branch: { select: { name: true } }, client: { select: { name: true } } } as const;

  const [timesheets, departments, shifts, placed, jobs] = await Promise.all([
    tdb.timesheet.findMany({ where: { status: { in: ['APPROVED', 'PAID'] }, weekEnding: { gte: new Date(`${addDays(from, -7)}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }, application: { job: inBranch } },
      select: { weekEnding: true, regularHours: true, overtimeHours: true, leaveHours: true, payRate: true, billRate: true, applicationId: true, application: { select: { candidateId: true, job: { select: jobSel } } } } }),
    group === 'department' ? tdb.employee.findMany({ select: { applicationId: true, candidateId: true, department: { select: { name: true } } } }) : [],
    tdb.shift.findMany({ where: { cancelled: false, response: { not: 'DECLINED' }, date: { gt: new Date(`${lastWeek}T00:00:00Z`), lte: new Date(`${addDays(lastWeek, 7 * 13)}T00:00:00Z`) }, application: { job: inBranch } },
      select: { date: true, start: true, end: true, breakMinutes: true, applicationId: true, application: { select: { candidateId: true, job: { select: jobSel } } } } }),
    // Time to fill: from a job being opened to its first placement, over the last year (published or client jobs only).
    tdb.application.findMany({ where: { stage: 'PLACED', stageChangedAt: { gte: new Date(now.getTime() - 365 * 864e5) }, job: { ...inBranch, OR: [{ publish: true }, { clientId: { not: null } }] } },
      select: { stageChangedAt: true, jobId: true, job: { select: { createdAt: true } } } }),
    tdb.job.findMany({ where: { status: 'OPEN', ...inBranch }, select: { ...jobSel, openings: true, _count: { select: { applications: { where: { stage: 'PLACED' } } } } } }),
  ]);

  const deptByApp = new Map<string, string>(), deptByPerson = new Map<string, string>();
  for (const e of departments) { const d = e.department?.name ?? 'No department'; if (e.applicationId) deptByApp.set(e.applicationId, d); deptByPerson.set(e.candidateId, d); }
  const segmentOf = (job: Job, applicationId: string, candidateId: string) =>
    group === 'department' ? deptByApp.get(applicationId) ?? deptByPerson.get(candidateId) ?? 'No department'
      : group === 'location' ? job.branch?.name ?? 'No location'
        : group === 'client' ? job.client?.name ?? 'Internal'
          : group === 'position' ? job.title : 'Everyone';

  const rows: WeekRow[] = timesheets.map((t) => {
    const reg = Number(t.regularHours), ot = Number(t.overtimeHours), leave = Number(t.leaveHours), pay = Number(t.payRate), bill = Number(t.billRate);
    return {
      week: ymd(t.weekEnding), segment: segmentOf(t.application.job, t.applicationId, t.application.candidateId), worker: t.application.candidateId,
      hours: reg + ot, overtime: ot, costCents: cents(reg * pay) + cents(ot * pay * OT_MULTIPLIER) + cents(leave * pay), billCents: cents(reg * bill) + cents(ot * bill * OT_MULTIPLIER),
    };
  });
  const scheduled = new Map<string, Map<string, number>>();
  for (const s of shifts) {
    const seg = segmentOf(s.application.job, s.applicationId, s.application.candidateId), w = weekOf(ymd(s.date));
    const m = scheduled.get(seg) ?? new Map<string, number>(); m.set(w, (m.get(w) ?? 0) + shiftHours(s)); scheduled.set(seg, m);
    const all = scheduled.get('*') ?? new Map<string, number>(); all.set(w, (all.get(w) ?? 0) + shiftHours(s)); scheduled.set('*', all);
  }
  const firstFill = new Map<string, number>();
  for (const a of placed) { const d = (a.stageChangedAt.getTime() - a.job.createdAt.getTime()) / 864e5; if (d >= 1 && (!firstFill.has(a.jobId) || d < firstFill.get(a.jobId)!)) firstFill.set(a.jobId, d); }
  const ttfSample = [...firstFill.values()];
  const timeToFill = ttfSample.length >= 3 ? Math.round(median(ttfSample)!) : 21;
  const openBy = new Map<string, number>();
  let openAll = 0;
  for (const j of jobs) {
    const open = Math.max(0, j.openings - j._count.applications); if (!open) continue;
    openAll += open;
    const seg = group === 'location' ? j.branch?.name ?? 'No location' : group === 'client' ? j.client?.name ?? 'Internal' : group === 'position' ? j.title : group === 'all' ? 'Everyone' : null;
    if (seg) openBy.set(seg, (openBy.get(seg) ?? 0) + open);
  }

  // The plan for everyone, then each segment (largest by hours this year first).
  const plan = (segment?: string) => {
    const mine = segment ? rows.filter((r) => r.segment === segment) : rows;
    const sched = scheduled.get(segment ?? '*');
    const f = forecast(weekly(mine), lastWeek, { scheduled: sched });
    const c = capacity(mine, lastWeek);
    return { forecast: f, capacity: c, hiring: hiringPlan(f, c, today, timeToFill, segment ? openBy.get(segment) ?? 0 : openAll) };
  };
  const segHours = new Map<string, number>();
  for (const r of rows) if (r.week >= `${year}-01-01`) segHours.set(r.segment, (segHours.get(r.segment) ?? 0) + r.hours);
  const segments = group === 'all' ? [] : [...segHours.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);

  return {
    today, lastWeek, year, thisYear, group, kind: org.kind, staffing: org.kind !== 'EMPLOYER', timeToFill, timeToFillMeasured: ttfSample.length >= 3,
    monthly: monthly(rows, year, through), ytd: yearToDate(rows, year, through),
    overall: year === thisYear ? plan() : null,
    segments: year === thisYear ? segments.map((name) => ({ name, ...plan(name), ytd: yearToDate(rows.filter((r) => r.segment === name), year, through) })) : [],
    hasHistory: rows.some((r) => r.week < `${year}-01-01`), weeks: new Set(rows.map((r) => r.week)).size,
  };
}
export type Planning = Awaited<ReturnType<typeof loadPlanning>>;

/** Hours only: drops pay and billing for people who can't see pay (everyone but owners and admins). */
export function hoursOnly(p: Planning): Planning {
  return JSON.parse(JSON.stringify(p, (k, v) => (k === 'costCents' || k === 'billCents' ? 0 : k === 'costPerHour' ? { thisYear: null, lastYear: null } : v)));
}

/** The page as a spreadsheet: months, the 13-week forecast and the hiring plan. */
export function planningCsv(p: Planning, money: boolean) {
  const q = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows: unknown[][] = [[`Labor planning ${p.year} vs ${p.year - 1}`], [], ['Month', `${p.year} hours`, `${p.year - 1} hours`, ...(money ? [`${p.year} labor cost`, `${p.year - 1} labor cost`] : []), `${p.year} people`, `${p.year - 1} people`, `${p.year} overtime hours`, `${p.year - 1} overtime hours`]];
  for (const m of p.monthly) rows.push([`${p.year}-${String(m.month).padStart(2, '0')}${m.partial ? ' (so far)' : ''}`, m.thisYear?.hours ?? '', m.lastYear.hours, ...(money ? [m.thisYear ? (m.thisYear.costCents / 100).toFixed(2) : '', (m.lastYear.costCents / 100).toFixed(2)] : []), m.thisYear?.workers ?? '', m.lastYear.workers, m.thisYear?.overtime ?? '', m.lastYear.overtime]);
  if (p.overall) {
    rows.push([], ['Week ending', 'Hours needed', 'Scheduled', 'Same week last year', 'Current team hours', 'Short by (people)']);
    p.overall.forecast.forEach((w, i) => rows.push([w.week, w.hours, w.scheduled, w.lastYear, p.overall!.capacity.weeks[i].hours, p.overall!.hiring.weeks[i].gapPeople]));
    rows.push([], [GROUPS[p.group], 'Hours this year', 'Change vs last year %', 'People now', 'Peak need (hours)', 'Peak week', 'Short by (people)', 'Open jobs', 'Hire', 'Start hiring by']);
    for (const s of [{ name: 'Everyone', ...p.overall, ytd: p.ytd }, ...p.segments]) {
      rows.push([s.name, s.ytd.thisYear.hours, s.ytd.change.hours ?? '', s.capacity.active, s.hiring.peak?.need ?? '', s.hiring.peak?.week ?? '', s.hiring.peak?.gapPeople ?? 0, s.hiring.openReqs, s.hiring.hires, s.hiring.hires ? s.hiring.startBy ?? '' : '']);
    }
  }
  return rows.map((r) => r.map(q).join(',')).join('\n') + '\n';
}
