import { z } from 'zod';
import { requireApiContext, withApi, logActivity } from '@/lib/tenant';
import { addWeeks, parseWeek } from '@/lib/weeks';
import { assignmentWhere, parse } from '@/lib/schedule-server';
import { overlaps } from '@/lib/schedule';

const Body = z.object({ week: z.string() });
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Copy the previous week's shifts into this week (as unsent drafts), skipping any that would overlap. */
export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', feature: 'scheduling', write: true });
  const week = parseWeek(parse(Body, await req.json().catch(() => null)).week);
  const prevEnd = addWeeks(week, -1), prevStart = new Date(prevEnd.getTime() - 6 * 864e5), start = new Date(week.getTime() - 6 * 864e5);
  const [source, existing] = await Promise.all([
    tdb.shift.findMany({ where: { cancelled: false, date: { gte: prevStart, lte: prevEnd }, application: assignmentWhere }, include: { application: { select: { candidateId: true } } } }),
    tdb.shift.findMany({ where: { cancelled: false, date: { gte: new Date(start.getTime() - 864e5), lte: new Date(week.getTime() + 864e5) } }, include: { application: { select: { candidateId: true } } } }),
  ]);
  const taken = existing.map((e) => ({ c: e.application.candidateId, t: { date: ymd(e.date), start: e.start, end: e.end, breakMinutes: e.breakMinutes } }));
  const rows = [];
  let skipped = 0;
  for (const s of source) {
    const t = { date: ymd(new Date(s.date.getTime() + 7 * 864e5)), start: s.start, end: s.end, breakMinutes: s.breakMinutes };
    if (taken.some((x) => x.c === s.application.candidateId && overlaps(x.t, t))) { skipped++; continue; }
    taken.push({ c: s.application.candidateId, t });
    rows.push({ organizationId: org.id, applicationId: s.applicationId, date: new Date(`${t.date}T00:00:00Z`), start: s.start, end: s.end, breakMinutes: s.breakMinutes, unit: s.unit, notes: s.notes });
  }
  if (rows.length) await tdb.shift.createMany({ data: rows });
  if (rows.length) await logActivity(org.id, `Copied ${rows.length} shift${rows.length === 1 ? '' : 's'} from the previous week`, user.id);
  return Response.json({ copied: rows.length, skipped });
});
