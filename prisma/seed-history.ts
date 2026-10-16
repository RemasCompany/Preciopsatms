import type { PrismaClient } from '@prisma/client';

/**
 * Two years of weekly timesheets for a demo company, so labor planning has something to compare: a November–December
 * peak with overtime, a slow January–February, a mild summer bump, and last year about 8% lighter than this one.
 * Only for people already placed (each from their start date). Safe to run again: existing weeks are skipped.
 */
export async function seedHistory(db: PrismaClient, slug: string, now = new Date()) {
  const org = await db.organization.findUnique({ where: { slug } });
  if (!org) return 0;
  const DAY = 864e5, ymd = (d: Date) => d.toISOString().slice(0, 10);
  const sunday = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + ((7 - d.getUTCDay()) % 7)));
  const lastWeek = new Date(sunday(now).getTime() - 7 * DAY);
  const first = sunday(new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1)));
  // Deterministic noise, so the demo looks the same every time it's seeded.
  let seed = [...slug].reduce((s, c) => s * 31 + c.charCodeAt(0), 7) >>> 0;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const season = (m: number) => (m === 11 ? 1.18 : m === 12 ? 1.28 : m <= 2 ? 0.88 : m >= 6 && m <= 8 ? 1.05 : 1);

  const apps = await db.application.findMany({ where: { organizationId: org.id, stage: 'PLACED' }, include: { job: true, candidate: { select: { id: true } } } });
  const employees = await db.employee.findMany({ where: { organizationId: org.id }, select: { applicationId: true, startDate: true, payType: true, payRate: true, status: true } });
  const emp = new Map(employees.filter((e) => e.applicationId).map((e) => [e.applicationId!, e]));
  const data: object[] = [];
  for (const a of apps) {
    const e = emp.get(a.id);
    if (e && (e.payType === 'SALARY' || e.status === 'TERMINATED')) continue; // hourly people only
    const pay = Number(e?.payRate ?? a.job.payRate ?? 18), bill = Number(a.job.billRate ?? (e ? 0 : pay * 1.45));
    const start = e?.startDate ?? new Date(Math.min(a.createdAt.getTime(), first.getTime()));
    const base = 34 + rand() * 6; // this person's typical week
    for (let w = first; w <= lastWeek; w = new Date(w.getTime() + 7 * DAY)) {
      if (w.getTime() - 6 * DAY < start.getTime()) continue;
      const lastYear = w.getUTCFullYear() < now.getUTCFullYear();
      let h = base * season(w.getUTCMonth() + 1) * (lastYear ? 0.92 : 1) * (0.92 + rand() * 0.16);
      if (rand() < 0.04) h *= 0.5; // a short week now and then (sick day, holiday)
      h = Math.round(Math.min(56, h) * 4) / 4;
      const reg = Math.min(40, h), ot = Math.round((h - reg) * 4) / 4;
      data.push({ organizationId: org.id, applicationId: a.id, weekEnding: w, regularHours: reg, overtimeHours: ot, payRate: pay, billRate: bill,
        status: w.getTime() < lastWeek.getTime() - 14 * DAY ? 'PAID' : 'APPROVED', approvedAt: new Date(w.getTime() + DAY), ...(w.getTime() < lastWeek.getTime() - 14 * DAY ? { paidAt: new Date(w.getTime() + 5 * DAY) } : {}) });
    }
  }
  const r = await db.timesheet.createMany({ data: data as never, skipDuplicates: true });
  console.log(`[seed] ${slug}: ${r.count} weeks of history from ${ymd(first)} to ${ymd(lastWeek)}`);
  if (org.kind !== 'EMPLOYER' && r.count) await invoiceHistory(db, org.id, new Date(lastWeek.getTime() - 28 * DAY));
  return r.count;
}

/** A staffing firm bills its clients: one paid invoice per client per month for the history (not the last four weeks). */
export async function invoiceHistory(db: PrismaClient, orgId: string, before: Date) {
  const ts = await db.timesheet.findMany({ where: { organizationId: orgId, weekEnding: { lt: before }, status: 'PAID', application: { job: { clientId: { not: null } } } },
    include: { application: { include: { candidate: { select: { name: true } }, job: { select: { title: true, clientId: true } } } } }, orderBy: { weekEnding: 'asc' } });
  const billed = new Set((await db.invoiceLine.findMany({ where: { organizationId: orgId, timesheetId: { in: ts.map((t) => t.id) } }, select: { timesheetId: true } })).map((l) => l.timesheetId));
  const groups = new Map<string, typeof ts>();
  for (const t of ts) if (!billed.has(t.id)) { const k = `${t.application.job.clientId}|${t.weekEnding.toISOString().slice(0, 7)}`; groups.set(k, [...(groups.get(k) ?? []), t]); }
  const c = (n: number) => Math.round(n * 100);
  let made = 0;
  for (const [key, rows] of [...groups.entries()].sort((a, b) => a[0].split('|')[1].localeCompare(b[0].split('|')[1]))) {
    const [clientId, month] = key.split('|');
    const lines = rows.map((t) => { const reg = Number(t.regularHours), ot = Number(t.overtimeHours), rate = Number(t.billRate);
      return { timesheetId: t.id, worker: t.application.candidate.name, description: t.application.job.title, weekEnding: t.weekEnding, regularHours: reg, overtimeHours: ot, rate, amount: (c(reg * rate) + c(ot * rate * 1.5)) / 100 }; });
    const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    const [y, m] = month.split('-').map(Number);
    const issue = new Date(Date.UTC(y, m, 3)), due = new Date(issue.getTime() + 30 * 864e5), paidOn = new Date(issue.getTime() + 26 * 864e5);
    const seq = (await db.invoice.count({ where: { organizationId: orgId, number: { startsWith: `INV-${issue.getUTCFullYear()}-` } } })) + 1;
    const inv = await db.invoice.create({ data: { organizationId: orgId, clientId, number: `INV-${issue.getUTCFullYear()}-${String(seq).padStart(4, '0')}`, status: 'PAID', issueDate: issue, dueDate: due,
      periodStart: new Date(rows[0].weekEnding.getTime() - 6 * 864e5), periodEnd: rows[rows.length - 1].weekEnding, terms: 'Net 30', subtotal: total, total, amountPaid: total, sentAt: issue, paidAt: paidOn } });
    await db.invoiceLine.createMany({ data: lines.map((l, i) => ({ ...l, organizationId: orgId, invoiceId: inv.id, sortOrder: i })) });
    await db.payment.create({ data: { organizationId: orgId, invoiceId: inv.id, amount: total, receivedOn: paidOn, method: 'ach', reference: `ACH ${month}` } });
    made++;
  }
  console.log(`[seed] ${made} paid invoices for the history`);
}
