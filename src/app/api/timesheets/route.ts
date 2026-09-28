import { z } from 'zod';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { parseWeek } from '@/lib/weeks';
import { hoursAmount } from '@/lib/payroll';

/** Active assignments (placed on non-direct-hire jobs) with their timesheet for the week. */
export const GET = withApi(async (req: Request) => {
  const { tdb } = await requireApiContext({ feature: 'timesheets' });
  const week = parseWeek(new URL(req.url).searchParams.get('week'));
  const apps = await tdb.application.findMany({
    where: { stage: 'PLACED', job: { type: { not: 'DIRECT_HIRE' } } },
    include: { candidate: { select: { name: true, email: true } }, job: { select: { title: true, payRate: true, billRate: true, client: { select: { id: true, name: true } } } }, timesheets: { where: { weekEnding: week } } },
  });
  const rows = apps.map((a) => {
    const t = a.timesheets[0]; const pay = Number(t?.payRate ?? a.job.payRate ?? 0), bill = Number(t?.billRate ?? a.job.billRate ?? 0);
    const reg = Number(t?.regularHours ?? 0), ot = Number(t?.overtimeHours ?? 0);
    return { applicationId: a.id, worker: a.candidate.name, email: a.candidate.email, job: a.job.title, client: a.job.client, status: t?.status ?? 'NOT_ENTERED', reg, ot, pay, bill,
      gross: hoursAmount(reg, ot, pay), billable: hoursAmount(reg, ot, bill) };
  });
  return Response.json({ week: week.toISOString().slice(0, 10), rows });
});

const Upsert = z.object({ applicationId: z.string(), week: z.string(), regularHours: z.coerce.number().min(0).max(168), overtimeHours: z.coerce.number().min(0).max(168) });

export const PUT = withApi(async (req: Request) => {
  const { tdb } = await requireApiContext({ minRole: 'RECRUITER', feature: 'timesheets', write: true });
  const b = Upsert.parse(await req.json());
  const week = parseWeek(b.week);
  if (b.regularHours + b.overtimeHours > 168) throw new HttpError(400, 'More hours than exist in a week');
  const app = await tdb.application.findFirst({ where: { id: b.applicationId, stage: 'PLACED' }, include: { job: true } });
  if (!app) throw new HttpError(404, 'Assignment not found');
  const existing = await tdb.timesheet.findFirst({ where: { applicationId: app.id, weekEnding: week } });
  if (existing && existing.status !== 'DRAFT') throw new HttpError(409, 'This timesheet is already approved. Reopen it before editing.');
  if (existing) await tdb.timesheet.updateMany({ where: { id: existing.id }, data: { regularHours: b.regularHours, overtimeHours: b.overtimeHours } });
  else await tdb.timesheet.create({ data: { applicationId: app.id, weekEnding: week, regularHours: b.regularHours, overtimeHours: b.overtimeHours, payRate: app.job.payRate ?? 0, billRate: app.job.billRate ?? 0 } as never });
  return Response.json({ ok: true });
});
