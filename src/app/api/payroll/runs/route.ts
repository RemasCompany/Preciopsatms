import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { requireApiContext, withApi, logActivity, HttpError } from '@/lib/tenant';
import { parseWeek } from '@/lib/weeks';
import { FREQUENCIES } from '@/lib/payroll-run';
import { periodStartFor, syncItems } from '@/lib/payroll-run-server';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const Body = z.object({
  frequency: z.enum(Object.keys(FREQUENCIES) as [keyof typeof FREQUENCIES], { errorMap: () => ({ message: 'Choose weekly or every two weeks.' }) }),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the last day of the pay period.'),
  payDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a pay date.'),
  notes: z.string().max(500, 'Keep notes under 500 characters.').optional(),
});

/** Start a payroll run for a pay period: approved timesheets in the period are pulled in as a draft. */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'payrollRuns', write: true });
  const r = Body.safeParse(await req.json().catch(() => null));
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Invalid input');
  const b = r.data;
  let end: Date;
  try { end = parseWeek(b.periodEnd); } catch { throw new HttpError(400, 'Pay periods end on a Sunday. Choose a Sunday.'); }
  const start = periodStartFor(ymd(end), b.frequency);
  const pay = new Date(`${b.payDate}T00:00:00Z`);
  if (Number.isNaN(pay.getTime())) throw new HttpError(400, 'Choose a pay date.');
  if (pay < start || pay.getTime() > end.getTime() + 60 * 864e5) throw new HttpError(400, 'The pay date should fall within 60 days after the pay period.');
  const clash = await tdb.payrollRun.findFirst({ where: { status: { not: 'VOID' }, periodStart: { lte: end }, periodEnd: { gte: start } } });
  if (clash) throw new HttpError(409, `${clash.number} already covers ${fmt(clash.periodStart)} – ${fmt(clash.periodEnd)}. Void it first to redo that period.`);

  for (let attempt = 0; attempt < 3; attempt++) {
    const number = `PR-${String((await tdb.payrollRun.count()) + 1 + attempt).padStart(4, '0')}`;
    try {
      const run = await tdb.$transaction(async (tx) => {
        const created = await tx.payrollRun.create({ data: { number, frequency: b.frequency, periodStart: start, periodEnd: end, payDate: pay, notes: b.notes?.trim() || null, createdById: user.id } as never });
        const res = await syncItems(tx, created);
        return { ...created, ...res };
      });
      await logActivity(org.id, `Started payroll run ${number} for ${fmt(start)} – ${fmt(end)} (${run.included} timesheet${run.included === 1 ? '' : 's'})`, user.id);
      return Response.json({ id: run.id, number, included: run.included }, { status: 201 });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
  }
  throw new HttpError(409, 'Someone else started a run at the same moment. Refresh and try again.');
});
