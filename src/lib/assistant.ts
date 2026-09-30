import Anthropic from '@anthropic-ai/sdk';
import type { Organization, Role } from '@prisma/client';
import { db } from './db';
import { HttpError, tenantDb, type TenantDb } from './tenant';
import { hasFeature, PLANS } from './plans';
import { localDate } from './timeclock';
import { REPORTS, isReport, type Table } from './reports';
import { mayRun, runReport } from './reports-server';
import { balanceCents } from './invoicing-server';
import { scrub } from './monitoring';
import { assignmentWhere } from './schedule-server';

/**
 * The in-app assistant answers questions about the business ("what needs my attention?", "which client has the best
 * margin this quarter?") by calling read-only tools over this company's data.
 *
 * Privacy rules (CLAUDE.md): tools return counts, jobs, clients and money — never people. Workers are pseudonymized
 * ("Worker 1"), contact details and EEO data are never included, and emails/phone numbers typed into a question are
 * masked before it's sent. Pay and margin tools are only offered to owners and admins.
 */
const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL ?? 'claude-opus-5-5';
const MAX_STEPS = 6;

type Ctx = { org: Organization; role: Role; tdb: TenantDb; today: string };
const isAdmin = (r: Role) => r === 'OWNER' || r === 'ADMIN';
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Replaces person names in a report with "Worker N" (stable within one answer). */
function deidentify(t: Table, people: Map<string, string>) {
  const personCols = t.columns.filter((c) => c.key === 'worker').map((c) => c.key);
  const alias = (name: string) => { if (!people.has(name)) people.set(name, `Worker ${people.size + 1}`); return people.get(name)!; };
  return { ...t, rows: t.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, personCols.includes(k) && typeof v === 'string' ? alias(v) : v]))) };
}

async function overview({ org, role, tdb, today }: Ctx) {
  const d = new Date(`${today}T00:00:00Z`), week = new Date(d.getTime() + 7 * 864e5), month = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const byStage = await tdb.application.groupBy({ by: ['stage'], _count: true });
  const out: Record<string, unknown> = {
    today,
    openJobs: await tdb.job.count({ where: { status: 'OPEN' } }),
    applicationsByStage: Object.fromEntries(byStage.map((s) => [s.stage, s._count])),
    placedThisMonth: await tdb.application.count({ where: { stage: 'PLACED', stageChangedAt: { gte: month } } }),
    workersOnAssignment: await tdb.application.count({ where: assignmentWhere }),
    overdueTasks: await tdb.task.count({ where: { done: false, dueAt: { lt: d } } }),
    unreadTexts: await tdb.message.count({ where: { channel: 'sms', direction: 'in', readAt: null } }),
  };
  if (hasFeature(org, 'timesheets')) out.draftTimesheetsToApprove = await tdb.timesheet.count({ where: { status: 'DRAFT', OR: [{ regularHours: { gt: 0 } }, { overtimeHours: { gt: 0 } }] } });
  if (hasFeature(org, 'scheduling')) {
    out.shiftsNext7DaysAwaitingConfirmation = await tdb.shift.count({ where: { cancelled: false, notified: true, response: 'PENDING', date: { gte: d, lte: week } } });
    out.shiftsNext7DaysDeclined = await tdb.shift.count({ where: { cancelled: false, response: 'DECLINED', date: { gte: d, lte: week } } });
    out.openShiftsUnfilled = await tdb.openShift.count({ where: { status: 'OPEN', date: { gte: d } } });
  }
  if (hasFeature(org, 'credentials')) {
    out.credentialsExpired = await tdb.credential.count({ where: { expiresAt: { lt: d } } });
    out.credentialsExpiringIn30Days = await tdb.credential.count({ where: { expiresAt: { gte: d, lte: new Date(d.getTime() + 30 * 864e5) } } });
  }
  if (hasFeature(org, 'onboarding')) {
    out.onboardingsInProgress = await tdb.onboarding.count({ where: { status: 'IN_PROGRESS' } });
  }
  if (org.everifyEnabled && hasFeature(org, 'onboarding')) out.everifyCasesOverdue = await tdb.eVerifyCase.count({ where: { status: 'to_create', dueDate: { lt: d } } });
  if (isAdmin(role) && hasFeature(org, 'timesheets')) {
    const open = await tdb.invoice.findMany({ where: { status: { in: ['DRAFT', 'SENT', 'PARTIAL'] } }, select: { total: true, amountPaid: true, dueDate: true } });
    out.receivablesOpen = open.reduce((s, i) => s + balanceCents(i), 0) / 100;
    out.receivablesPastDue = open.filter((i) => ymd(i.dueDate) < today).reduce((s, i) => s + balanceCents(i), 0) / 100;
  }
  return out;
}

async function openJobs({ role, tdb, today }: Ctx) {
  const jobs = await tdb.job.findMany({ where: { status: { in: ['OPEN', 'ON_HOLD'] } }, orderBy: { createdAt: 'asc' }, take: 60,
    select: { title: true, status: true, type: true, location: true, openings: true, createdAt: true, payRate: true, billRate: true, hot: true, client: { select: { name: true } }, applications: { select: { stage: true } } } });
  return jobs.map((j) => ({
    title: j.title, client: j.client?.name ?? null, status: j.status, type: j.type, location: j.location, hot: j.hot, openings: j.openings,
    filled: j.applications.filter((a) => a.stage === 'PLACED').length,
    daysOpen: Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - j.createdAt.getTime()) / 864e5)),
    pipeline: j.applications.reduce<Record<string, number>>((m, a) => ({ ...m, [a.stage]: (m[a.stage] ?? 0) + 1 }), {}),
    ...(isAdmin(role) ? { payRate: j.payRate == null ? null : Number(j.payRate), billRate: j.billRate == null ? null : Number(j.billRate) } : {}),
  }));
}

function tools(c: Ctx): Anthropic.Beta.BetaTool[] {
  const reports = (Object.keys(REPORTS) as (keyof typeof REPORTS)[]).filter((k) => mayRun(c.org, c.role, k));
  return [
    { name: 'get_overview', description: 'Counts of what needs attention right now: open jobs, pipeline by stage, timesheets to approve, unconfirmed or declined shifts, expiring credentials, onboarding, E-Verify deadlines, overdue tasks, unread texts, and (for admins) receivables.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false }, strict: true },
    { name: 'list_open_jobs', description: 'Open and on-hold jobs with client, location, openings filled, days open and pipeline counts by stage (pay and bill rates for admins).',
      input_schema: { type: 'object', properties: {}, additionalProperties: false }, strict: true },
    { name: 'run_report', description: `Run a standard report for a date range. Available: ${reports.map((k) => `${k} (${REPORTS[k].title}: ${REPORTS[k].description})`).join('; ')}. Workers appear as "Worker N".`,
      input_schema: { type: 'object', properties: { report: { type: 'string', enum: reports }, from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['report', 'from', 'to'], additionalProperties: false }, strict: true },
  ];
}

async function runTool(c: Ctx, name: string, input: unknown, people: Map<string, string>) {
  if (name === 'get_overview') return overview(c);
  if (name === 'list_open_jobs') return openJobs(c);
  if (name === 'run_report') {
    const i = (input ?? {}) as { report?: string; from?: string; to?: string };
    if (!i.report || !isReport(i.report)) throw new HttpError(400, 'Unknown report.');
    return deidentify(await runReport(c.org, c.role, i.report, { from: i.from, to: i.to }), people);
  }
  throw new HttpError(400, `Unknown tool ${name}`);
}

const system = (c: Ctx) => `You are the assistant inside Preciops, software for a staffing company (${c.org.shortName ?? c.org.name}). You help recruiters and managers understand their business: open jobs, pipeline, placements, hours, schedules, compliance deadlines and money.

Answer from the tools, not from memory: call them for any number you give, and say plainly when the data doesn't cover the question. Individual workers are deliberately de-identified ("Worker 1"); if someone asks about a specific person, tell them to open that person's record in the app. Today is ${c.today} (${c.org.timezone}). ${isAdmin(c.role) ? '' : 'This person is not an admin, so pay, margin and receivables aren’t available to them.'}

Be brief and practical: lead with the answer, then at most a few bullet points. Suggest the next action in the app when it helps (e.g. "approve 4 timesheets on the Timesheets page").`;

type Turn = { q: string; a: string };

/** Answers one question (with recent Q&A for context). Costs one AI credit, refunded if nothing comes back. */
export async function ask(org: Organization, role: Role, question: string, history: Turn[] = []) {
  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(503, 'AI isn’t set up on this server yet (ANTHROPIC_API_KEY is missing).');
  if (!hasFeature(org, 'ai')) throw new HttpError(402, 'The assistant is included in the Growth and Enterprise plans.');
  const limit = PLANS[org.plan].monthlyAiCredits;
  const spent = await db.organization.updateMany({ where: { id: org.id, aiCreditsUsed: { lt: limit } }, data: { aiCreditsUsed: { increment: 1 } } });
  if (!spent.count) throw new HttpError(402, 'You have used all AI credits for this billing period.');
  const c: Ctx = { org, role, tdb: tenantDb(org.id), today: localDate(new Date(), org.timezone) };
  const people = new Map<string, string>();
  // Earlier turns go in as plain text (no replayed model output), so every request is a fresh, unedited conversation.
  const context = history.slice(-4).map((t) => `Q: ${scrub(t.q).slice(0, 500)}\nA: ${t.a.slice(0, 1500)}`).join('\n\n');
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: `${context ? `Earlier in this conversation:\n${context}\n\nNew question: ` : ''}${scrub(question)}` }];
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await client.beta.messages.create({
        model: MODEL, max_tokens: 16000, system: system(c), tools: tools(c), messages,
        output_config: { effort: 'low' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      } as Anthropic.Beta.MessageCreateParamsNonStreaming);
      if (res.stop_reason === 'refusal') return { answer: 'I can’t help with that one. Try asking about jobs, placements, hours, schedules or invoices.' };
      const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || !uses.length) {
        const answer = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
        return { answer: answer || 'I couldn’t find an answer to that.' };
      }
      messages.push({ role: 'assistant', content: res.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const u of uses) {
        try { results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(await runTool(c, u.name, u.input, people)) }); }
        catch (e) { results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: e instanceof HttpError ? e.message : 'That lookup failed.' }); }
      }
      messages.push({ role: 'user', content: results });
    }
    return { answer: 'That question needed more lookups than I can do at once. Try asking something narrower.' };
  } catch (e) {
    await db.organization.updateMany({ where: { id: org.id, aiCreditsUsed: { gt: 0 } }, data: { aiCreditsUsed: { decrement: 1 } } });
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new HttpError(503, 'AI isn’t set up correctly on this server (the API key was rejected).');
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'AI is busy right now. Wait a minute and try again.');
    if (e instanceof Anthropic.APIError) throw new HttpError(502, 'The assistant couldn’t finish that. Try again.');
    throw e;
  }
}
