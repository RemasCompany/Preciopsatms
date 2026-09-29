import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { parseWeek } from '@/lib/weeks';
import { timesheetRows } from '@/lib/timesheets';

/** Active assignments (placed on non-direct-hire jobs) with their timesheet for the week. */
// Per-user data: never pre-render or cache.
export const dynamic = 'force-dynamic';

export const GET = withApi(async (req: Request) => {
  const { tdb } = await requireApiContext({ feature: 'timesheets' });
  const week = parseWeek(new URL(req.url).searchParams.get('week'));
  return Response.json({ week: week.toISOString().slice(0, 10), rows: await timesheetRows(tdb, week) });
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
  const hours = { regularHours: b.regularHours, overtimeHours: b.overtimeHours };
  if (existing) await tdb.timesheet.updateMany({ where: { id: existing.id }, data: hours });
  else {
    try {
      await tdb.timesheet.create({ data: { applicationId: app.id, weekEnding: week, ...hours, payRate: app.job.payRate ?? 0, billRate: app.job.billRate ?? 0 } as never });
    } catch (e) {
      // Two saves raced to create the same week; the other one won, so update it (only while still a draft).
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      const { count } = await tdb.timesheet.updateMany({ where: { applicationId: app.id, weekEnding: week, status: 'DRAFT' }, data: hours });
      if (!count) throw new HttpError(409, 'This timesheet is already approved. Reopen it before editing.');
    }
  }
  return Response.json({ ok: true });
});
