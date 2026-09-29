// Sales team metrics: revenue won against quota, win rate, cycle length, pipeline, lead conversion and outreach, per rep.
// Pure functions over plain rows so the math is testable; the page loads the rows through tenantDb.
import { DEAL_PROBABILITY, type DealStage } from './deals';

export type SalesDeal = {
  id: string; title: string; client: string | null; value: number | null; stage: string; ownerId: string | null;
  createdAt: Date; closedAt: Date | null; stageChangedAt: Date; closeDate: Date | null;
};
export type SalesLead = { ownerId: string | null; status: string; createdAt: Date; convertedAt: Date | null };
export type SalesMessage = { sentById: string | null; createdAt: Date };
export type SalesTargetRow = { userId: string; month: string; amount: number }; // month = 'YYYY-MM'
export type Rep = { id: string; label: string };

export const PERIODS = {
  month: 'This month', lastMonth: 'Last month', quarter: 'This quarter', lastQuarter: 'Last quarter', ytd: 'Year to date', last12: 'Last 12 months',
} as const;
export type PeriodKey = keyof typeof PERIODS;
export const isPeriod = (p: unknown): p is PeriodKey => typeof p === 'string' && p in PERIODS;

/** Deals open this long without a stage change need attention. */
export const STALE_DAYS = 14;
const DAY = 86_400_000;

const utcMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 1));
export const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/** [from, to) for a preset, whole UTC months. */
export function periodRange(p: PeriodKey, now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), q = m - (m % 3);
  switch (p) {
    case 'month': return { from: utcMonth(y, m), to: utcMonth(y, m + 1) };
    case 'lastMonth': return { from: utcMonth(y, m - 1), to: utcMonth(y, m) };
    case 'quarter': return { from: utcMonth(y, q), to: utcMonth(y, q + 3) };
    case 'lastQuarter': return { from: utcMonth(y, q - 3), to: utcMonth(y, q) };
    case 'ytd': return { from: utcMonth(y, 0), to: utcMonth(y, m + 1) };
    case 'last12': return { from: utcMonth(y, m - 11), to: utcMonth(y, m + 1) };
  }
}

/** Month keys from `from` up to (not including) `to`. */
export function monthsIn(from: Date, to: Date) {
  const out: string[] = [];
  for (let d = new Date(from); d < to; d = utcMonth(d.getUTCFullYear(), d.getUTCMonth() + 1)) out.push(monthKey(d));
  return out;
}

const inRange = (d: Date | null, from: Date, to: Date) => !!d && d >= from && d < to;
const isOpen = (stage: string) => stage !== 'Won' && stage !== 'Lost';
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const ratio = (a: number, b: number) => (b ? a / b : null);

function core(deals: SalesDeal[], leads: SalesLead[], messages: SalesMessage[], targets: SalesTargetRow[], from: Date, to: Date) {
  const won = deals.filter((d) => d.stage === 'Won' && inRange(d.closedAt, from, to));
  const lost = deals.filter((d) => d.stage === 'Lost' && inRange(d.closedAt, from, to));
  const open = deals.filter((d) => isOpen(d.stage));
  const wonRevenue = sum(won.map((d) => d.value ?? 0));
  const months = new Set(monthsIn(from, to));
  const target = sum(targets.filter((t) => months.has(t.month)).map((t) => t.amount));
  const newLeads = leads.filter((l) => inRange(l.createdAt, from, to));
  return {
    wonRevenue,
    wonCount: won.length,
    lostCount: lost.length,
    winRate: ratio(won.length, won.length + lost.length),
    avgDeal: won.length ? wonRevenue / won.length : null,
    avgCycleDays: won.length ? sum(won.map((d) => (d.closedAt!.getTime() - d.createdAt.getTime()) / DAY)) / won.length : null,
    openPipeline: sum(open.map((d) => d.value ?? 0)),
    weighted: sum(open.map((d) => (d.value ?? 0) * (DEAL_PROBABILITY[d.stage as DealStage] ?? 0))),
    openCount: open.length,
    newLeads: newLeads.length,
    // Of the leads that came in during the period, the share converted to a client (so far).
    leadConversion: ratio(newLeads.filter((l) => l.status === 'Converted').length, newLeads.length),
    convertedLeads: leads.filter((l) => l.status === 'Converted' && inRange(l.convertedAt, from, to)).length,
    outreach: messages.filter((m) => inRange(m.createdAt, from, to)).length,
    target: target || null,
    attainment: target ? wonRevenue / target : null,
  };
}
export type SalesKpis = ReturnType<typeof core>;

export function salesMetrics(input: {
  deals: SalesDeal[]; leads: SalesLead[]; messages: SalesMessage[]; targets: SalesTargetRow[]; reps: Rep[];
  from: Date; to: Date; rep?: string | null; now?: Date;
}) {
  const { from, to, reps, rep, now = new Date() } = input;
  const mine = <T,>(rows: T[], key: (r: T) => string | null) => (rep ? rows.filter((r) => key(r) === rep) : rows);
  const deals = mine(input.deals, (d) => d.ownerId);
  const leads = mine(input.leads, (l) => l.ownerId);
  const messages = mine(input.messages, (m) => m.sentById);
  const targets = mine(input.targets, (t) => t.userId);

  const kpis = core(deals, leads, messages, targets, from, to);

  // Leaderboard: every rep with any activity or a target, plus an "Unassigned" row when deals or leads have no owner.
  const repIds = new Set(reps.map((r) => r.id));
  const board = [...reps, { id: '', label: 'Unassigned' }].map((r) => {
    const by = (x: string | null) => (r.id ? x === r.id : !x || !repIds.has(x));
    return { id: r.id, label: r.label, ...core(input.deals.filter((d) => by(d.ownerId)), input.leads.filter((l) => by(l.ownerId)),
      r.id ? input.messages.filter((m) => m.sentById === r.id) : [], r.id ? input.targets.filter((t) => t.userId === r.id) : [], from, to) };
  }).filter((r) => r.wonCount || r.lostCount || r.openCount || r.newLeads || r.outreach || r.target)
    .sort((a, b) => b.wonRevenue - a.wonRevenue || b.weighted - a.weighted || a.label.localeCompare(b.label));

  // Won revenue for the six months ending with the period's last month, against target.
  const endMonth = new Date(to.getTime() - 1);
  const chartFrom = utcMonth(endMonth.getUTCFullYear(), endMonth.getUTCMonth() - 5);
  const monthly = monthsIn(chartFrom, utcMonth(endMonth.getUTCFullYear(), endMonth.getUTCMonth() + 1)).map((month) => ({
    month,
    won: sum(deals.filter((d) => d.stage === 'Won' && d.closedAt && monthKey(d.closedAt) === month).map((d) => d.value ?? 0)),
    target: sum(targets.filter((t) => t.month === month).map((t) => t.amount)) || null,
  }));

  // Lead funnel for leads created in the period: every stage counts the leads that got at least that far.
  const cohort = leads.filter((l) => inRange(l.createdAt, from, to));
  const funnel = [
    { label: 'New leads', count: cohort.length },
    { label: 'Contacted', count: cohort.filter((l) => l.status !== 'New').length },
    { label: 'Qualified', count: cohort.filter((l) => l.status === 'Qualified' || l.status === 'Converted').length },
    { label: 'Converted', count: cohort.filter((l) => l.status === 'Converted').length },
  ];

  const byStage = (['Prospect', 'Qualified', 'Proposal', 'Negotiation'] as const).map((stage) => {
    const ds = deals.filter((d) => d.stage === stage);
    return { stage, count: ds.length, value: sum(ds.map((d) => d.value ?? 0)) };
  });

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const attention = deals.filter((d) => isOpen(d.stage)).flatMap((d) => {
    const idle = Math.floor((now.getTime() - d.stageChangedAt.getTime()) / DAY);
    const overdue = !!d.closeDate && d.closeDate < today;
    if (!overdue && idle < STALE_DAYS) return [];
    return [{ id: d.id, title: d.title, client: d.client, value: d.value, stage: d.stage, ownerId: d.ownerId, idleDays: idle,
      closeDate: d.closeDate ? d.closeDate.toISOString().slice(0, 10) : null,
      reason: overdue ? `Expected close ${d.closeDate!.toISOString().slice(0, 10)} has passed` : `No stage change in ${idle} days` }];
  }).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  return { kpis, board, monthly, funnel, byStage, attention };
}
export type SalesMetrics = ReturnType<typeof salesMetrics>;
