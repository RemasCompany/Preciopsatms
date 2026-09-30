import type { TenantDb } from './tenant';
import { lineCents } from './invoicing';
import { STAGE_ORDER } from './eeo';

/** Standard reports: each takes a date range (inclusive, YYYY-MM-DD) and optional branch, and returns a table. */
export type Range = { from: string; to: string };
export type Cell = string | number | null;
export type Table = { columns: { key: string; label: string; money?: boolean; pct?: boolean; num?: boolean }[]; rows: Record<string, Cell>[]; total?: Record<string, Cell>; note?: string };
type Ctx = { tdb: TenantDb; range: Range; branchId: string | null };

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const endOf = (s: string) => new Date(day(s).getTime() + 864e5);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;
const jobBranch = (b: string | null) => (b ? { branchId: b } : {});
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
const label = (s: string) => s[0] + s.slice(1).toLowerCase().replace('_', ' ');

async function timesheets({ tdb, range, branchId }: Ctx) {
  return tdb.timesheet.findMany({
    where: { status: { in: ['APPROVED', 'PAID'] }, weekEnding: { gte: day(range.from), lte: day(range.to) }, application: { job: jobBranch(branchId) } },
    select: { regularHours: true, overtimeHours: true, payRate: true, billRate: true, application: { select: { candidate: { select: { id: true, name: true } }, job: { select: { title: true, client: { select: { id: true, name: true } } } } } } },
  });
}

export const REPORTS = {
  placements: {
    admin: true,
    title: 'Placements', description: 'People placed in the period, with rates and spread per hour.',
    async run(c: Ctx): Promise<Table> {
      const apps = await c.tdb.application.findMany({ where: { stage: 'PLACED', stageChangedAt: { gte: day(c.range.from), lt: endOf(c.range.to) }, job: jobBranch(c.branchId) },
        orderBy: { stageChangedAt: 'asc' }, select: { stageChangedAt: true, candidate: { select: { name: true, source: true } }, job: { select: { title: true, type: true, payRate: true, billRate: true, client: { select: { name: true } } } } } });
      const rows = apps.map((a) => {
        const pay = Number(a.job.payRate ?? 0), bill = Number(a.job.billRate ?? 0);
        return { date: ymd(a.stageChangedAt), worker: a.candidate.name, job: a.job.title, client: a.job.client?.name ?? '—', type: label(a.job.type), source: a.candidate.source ?? '—', pay, bill, spread: r2(bill - pay), markup: pay ? pct(bill - pay, pay) : null };
      });
      return { columns: [{ key: 'date', label: 'Placed' }, { key: 'worker', label: 'Worker' }, { key: 'job', label: 'Job' }, { key: 'client', label: 'Client' }, { key: 'type', label: 'Type' }, { key: 'source', label: 'Source' },
        { key: 'pay', label: 'Pay/hr', money: true }, { key: 'bill', label: 'Bill/hr', money: true }, { key: 'spread', label: 'Spread/hr', money: true }, { key: 'markup', label: 'Markup', pct: true }],
        rows, total: { date: `${rows.length} placement${rows.length === 1 ? '' : 's'}` }, note: 'Counts people still placed; the date is when they moved to Placed.' };
    },
  },
  margin: {
    admin: true,
    title: 'Gross margin by client', description: 'Approved hours billed and paid, by client, with margin before employer taxes.',
    async run(c: Ctx): Promise<Table> {
      const by = new Map<string, { client: string; hours: number; ot: number; billed: number; paid: number }>();
      for (const t of await timesheets(c)) {
        const reg = Number(t.regularHours), ot = Number(t.overtimeHours), cl = t.application.job.client;
        const k = cl?.id ?? 'none', r = by.get(k) ?? { client: cl?.name ?? 'No client', hours: 0, ot: 0, billed: 0, paid: 0 };
        r.hours += reg + ot; r.ot += ot; r.billed += lineCents(reg, ot, Number(t.billRate)); r.paid += lineCents(reg, ot, Number(t.payRate));
        by.set(k, r);
      }
      const rows = [...by.values()].sort((a, b) => b.billed - a.billed).map((r) => ({ client: r.client, hours: r2(r.hours), ot: r2(r.ot), billed: r.billed / 100, paid: r.paid / 100, margin: (r.billed - r.paid) / 100, marginPct: pct(r.billed - r.paid, r.billed) }));
      const sum = (k: 'hours' | 'ot' | 'billed' | 'paid' | 'margin') => r2(rows.reduce((s, r) => s + r[k], 0));
      return { columns: [{ key: 'client', label: 'Client' }, { key: 'hours', label: 'Hours', num: true }, { key: 'ot', label: 'OT hours', num: true }, { key: 'billed', label: 'Billed', money: true }, { key: 'paid', label: 'Gross pay', money: true }, { key: 'margin', label: 'Margin', money: true }, { key: 'marginPct', label: 'Margin %', pct: true }],
        rows, total: { client: 'Total', hours: sum('hours'), ot: sum('ot'), billed: sum('billed'), paid: sum('paid'), margin: sum('margin'), marginPct: pct(sum('margin'), sum('billed')) }, note: 'Approved and paid timesheets for weeks ending in the period. Margin is before payroll taxes, workers’ comp and benefits.' };
    },
  },
  hours: {
    admin: true,
    title: 'Hours by worker', description: 'Approved regular and overtime hours per worker.',
    async run(c: Ctx): Promise<Table> {
      const by = new Map<string, { worker: string; reg: number; ot: number; gross: number }>();
      for (const t of await timesheets(c)) {
        const w = t.application.candidate, reg = Number(t.regularHours), ot = Number(t.overtimeHours);
        const r = by.get(w.id) ?? { worker: w.name, reg: 0, ot: 0, gross: 0 };
        r.reg += reg; r.ot += ot; r.gross += lineCents(reg, ot, Number(t.payRate)); by.set(w.id, r);
      }
      const rows = [...by.values()].sort((a, b) => a.worker.localeCompare(b.worker)).map((r) => ({ worker: r.worker, reg: r2(r.reg), ot: r2(r.ot), total: r2(r.reg + r.ot), gross: r.gross / 100, otShare: pct(r.ot, r.reg + r.ot) }));
      return { columns: [{ key: 'worker', label: 'Worker' }, { key: 'reg', label: 'Regular', num: true }, { key: 'ot', label: 'Overtime', num: true }, { key: 'total', label: 'Total', num: true }, { key: 'gross', label: 'Gross pay', money: true }, { key: 'otShare', label: 'OT share', pct: true }],
        rows, total: { worker: `${rows.length} worker${rows.length === 1 ? '' : 's'}`, reg: r2(rows.reduce((s, r) => s + r.reg, 0)), ot: r2(rows.reduce((s, r) => s + r.ot, 0)), total: r2(rows.reduce((s, r) => s + r.total, 0)), gross: r2(rows.reduce((s, r) => s + r.gross, 0)) } };
    },
  },
  funnel: {
    admin: false,
    title: 'Pipeline funnel', description: 'How far applications that started in the period got, and conversion from each stage.',
    async run(c: Ctx): Promise<Table> {
      const apps = await c.tdb.application.findMany({ where: { createdAt: { gte: day(c.range.from), lt: endOf(c.range.to) }, job: jobBranch(c.branchId) }, select: { maxStage: true } });
      const reached = (s: string) => apps.filter((a) => STAGE_ORDER.indexOf(a.maxStage) >= STAGE_ORDER.indexOf(s as never)).length;
      const stages = STAGE_ORDER.filter((s) => s !== 'REJECTED' && s !== 'SOURCED');
      const rows = stages.map((s, i) => ({ stage: label(s), reached: reached(s), fromPrev: i ? pct(reached(s), reached(stages[i - 1])) : null, ofAll: pct(reached(s), apps.length) }));
      return { columns: [{ key: 'stage', label: 'Stage' }, { key: 'reached', label: 'Reached', num: true }, { key: 'fromPrev', label: 'From previous stage', pct: true }, { key: 'ofAll', label: 'Of all applications', pct: true }],
        rows, total: { stage: `${apps.length} applications` } };
    },
  },
  sources: {
    admin: false,
    title: 'Candidate sources', description: 'Where candidates who applied in the period came from, and how many were placed.',
    async run(c: Ctx): Promise<Table> {
      const apps = await c.tdb.application.findMany({ where: { createdAt: { gte: day(c.range.from), lt: endOf(c.range.to) }, job: jobBranch(c.branchId) }, select: { stage: true, maxStage: true, candidate: { select: { source: true } } } });
      const by = new Map<string, { apps: number; interviewed: number; placed: number }>();
      for (const a of apps) {
        const k = a.candidate.source ?? 'Unknown', r = by.get(k) ?? { apps: 0, interviewed: 0, placed: 0 };
        r.apps++; if (STAGE_ORDER.indexOf(a.maxStage) >= STAGE_ORDER.indexOf('INTERVIEW')) r.interviewed++; if (a.stage === 'PLACED') r.placed++;
        by.set(k, r);
      }
      const rows = [...by].sort((a, b) => b[1].placed - a[1].placed || b[1].apps - a[1].apps).map(([source, r]) => ({ source, apps: r.apps, interviewed: r.interviewed, placed: r.placed, rate: pct(r.placed, r.apps) }));
      return { columns: [{ key: 'source', label: 'Source' }, { key: 'apps', label: 'Applications', num: true }, { key: 'interviewed', label: 'Interviewed', num: true }, { key: 'placed', label: 'Placed', num: true }, { key: 'rate', label: 'Placement rate', pct: true }], rows };
    },
  },
  timeToFill: {
    admin: false,
    title: 'Time to fill', description: 'Days from opening a job to its first placement, for jobs first filled in the period.',
    async run(c: Ctx): Promise<Table> {
      const jobs = await c.tdb.job.findMany({ where: { ...jobBranch(c.branchId), applications: { some: { stage: 'PLACED' } } },
        select: { title: true, createdAt: true, client: { select: { name: true } }, applications: { where: { stage: 'PLACED' }, orderBy: { stageChangedAt: 'asc' }, take: 1, select: { stageChangedAt: true } } } });
      const from = day(c.range.from), to = endOf(c.range.to);
      const rows = jobs.map((j) => ({ j, first: j.applications[0].stageChangedAt })).filter(({ first }) => first >= from && first < to)
        .map(({ j, first }) => ({ job: j.title, client: j.client?.name ?? '—', opened: ymd(j.createdAt), filled: ymd(first), days: Math.max(0, Math.round((first.getTime() - j.createdAt.getTime()) / 864e5)) }))
        .sort((a, b) => a.days - b.days);
      const avg = rows.length ? Math.round((rows.reduce((s, r) => s + r.days, 0) / rows.length) * 10) / 10 : null;
      const med = rows.length ? rows[Math.floor((rows.length - 1) / 2)].days : null;
      return { columns: [{ key: 'job', label: 'Job' }, { key: 'client', label: 'Client' }, { key: 'opened', label: 'Opened' }, { key: 'filled', label: 'First placement' }, { key: 'days', label: 'Days', num: true }],
        rows, total: { job: rows.length ? `Average ${avg} days · median ${med}` : '' } };
    },
  },
} as const;
export type ReportKey = keyof typeof REPORTS;
export const isReport = (k: string): k is ReportKey => k in REPORTS;

export function tableCsv(t: Table) {
  const head = t.columns.map((c) => c.label);
  const line = (r: Record<string, Cell>) => t.columns.map((c) => r[c.key] ?? '');
  return [head, ...t.rows.map(line), ...(t.total ? [line(t.total)] : [])];
}

/** Last full week (Mon–Sun) or last full month before `today`. */
export function previousPeriod(freq: 'weekly' | 'monthly', today: string): Range {
  const d = day(today);
  if (freq === 'monthly') {
    const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)), last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
    return { from: ymd(first), to: ymd(last) };
  }
  const sunday = new Date(d.getTime() - (d.getUTCDay() === 0 ? 7 : d.getUTCDay()) * 864e5);
  return { from: ymd(new Date(sunday.getTime() - 6 * 864e5)), to: ymd(sunday) };
}
