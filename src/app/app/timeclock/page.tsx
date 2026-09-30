import Link from 'next/link';
import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { addWeeks, parseWeek } from '@/lib/weeks';
import { assignmentWhere } from '@/lib/schedule-server';
import { weekRange } from '@/lib/timeclock-server';
import { TIMEZONES, entryFlags, localDate, localTime, splitWeek, weekEndingOf, workedMinutes, type Entry } from '@/lib/timeclock';
import TimeclockBoard, { type TcWorker } from '@/components/TimeclockBoard';
import Gate from '@/components/Gate';
import JobSites from '@/components/JobSites';
import { DEFAULT_RADIUS_M, howFar } from '@/lib/geo';

export const dynamic = 'force-dynamic';
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const fmt = (s: string, o: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { ...o, timeZone: 'UTC' });

export default async function Timeclock({ searchParams }: { searchParams: { week?: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'timeclock')) return <Gate title="Time clock" feature="Time clock" />;
  const tz = ctx.org.timezone;
  const thisWeek = weekEndingOf(localDate(new Date(), tz));
  let week = thisWeek;
  try { if (searchParams.week) week = ymd(parseWeek(searchParams.week)); } catch { /* keep this week */ }
  const { from, to } = weekRange(week, tz);
  const now = new Date();

  const [apps, rows, openNow] = await Promise.all([
    ctx.tdb.application.findMany({ where: assignmentWhere, include: { candidate: { select: { id: true, name: true, email: true, phone: true, emailOptOut: true, smsOptOut: true } }, job: { select: { title: true, client: { select: { name: true } } } }, timesheets: { where: { weekEnding: new Date(`${week}T00:00:00Z`) }, select: { status: true } } }, orderBy: { candidate: { name: 'asc' } } }),
    ctx.tdb.timeEntry.findMany({ where: { clockIn: { gte: from, lt: to } }, include: { application: { select: { candidateId: true, job: { select: { title: true } } } } }, orderBy: { clockIn: 'asc' } }),
    ctx.tdb.timeEntry.findMany({ where: { clockOut: null }, include: { application: { select: { candidate: { select: { name: true } }, job: { select: { title: true } } } } }, orderBy: { clockIn: 'asc' } }),
  ]);
  const shiftIds = rows.map((r) => r.shiftId).filter(Boolean) as string[];
  const shifts = shiftIds.length ? await ctx.tdb.shift.findMany({ where: { id: { in: shiftIds } } }) : [];
  const entries: Entry[] = rows.map((r) => ({ id: r.id, applicationId: r.applicationId, candidateId: r.application.candidateId, clockIn: r.clockIn, clockOut: r.clockOut, breakMinutes: r.breakMinutes, breakStartedAt: r.breakStartedAt }));
  const split = splitWeek(entries, tz);

  // Everyone on assignment, plus anyone with punches this week on an assignment that has since ended.
  const people = new Map<string, TcWorker>();
  for (const a of apps) {
    const w = people.get(a.candidate.id) ?? { candidateId: a.candidate.id, name: a.candidate.name, canText: !!a.candidate.phone && !a.candidate.smsOptOut, canEmail: !!a.candidate.email && !a.candidate.emailOptOut, apps: [], entries: [], regular: 0, overtime: 0, locked: false };
    w.apps.push({ id: a.id, label: [a.job.title, a.job.client?.name].filter(Boolean).join(' — ') });
    if (a.timesheets.some((t) => t.status !== 'DRAFT')) w.locked = true;
    people.set(a.candidate.id, w);
  }
  for (const r of rows) {
    const w = people.get(r.application.candidateId);
    if (!w) continue;
    const s = shifts.find((x) => x.id === r.shiftId);
    const e = entries.find((x) => x.id === r.id)!;
    w.entries.push({
      id: r.id, applicationId: r.applicationId, job: r.application.job.title,
      inDate: localDate(r.clockIn, tz), inTime: localTime(r.clockIn, tz), outDate: r.clockOut ? localDate(r.clockOut, tz) : null, outTime: r.clockOut ? localTime(r.clockOut, tz) : null,
      breakMinutes: r.breakMinutes, minutes: Math.round(workedMinutes(e, now)), open: !r.clockOut,
      flags: entryFlags({ ...e, shift: s ? { date: ymd(s.date), start: s.start, end: s.end } : null, source: r.source, editedAt: r.editedAt }, tz, now),
      editReason: r.editReason, original: r.originalClockIn ? `${localTime(r.originalClockIn, tz)}–${r.originalClockOut ? localTime(r.originalClockOut, tz) : 'open'}` : null,
      inGeo: r.inLat != null && r.inLng != null ? { lat: r.inLat, lng: r.inLng, acc: r.inAccuracy } : null,
      outGeo: r.outLat != null && r.outLng != null ? { lat: r.outLat, lng: r.outLng, acc: r.outAccuracy } : null,
      offSite: !r.offSite ? null : [r.inDistanceM, r.outDistanceM].some((d) => d != null)
        ? `${howFar(Math.max(r.inDistanceM ?? 0, r.outDistanceM ?? 0))} from the site` : 'no location shared',
    });
  }
  for (const s of split) {
    const w = [...people.values()].find((p) => p.apps.some((a) => a.id === s.applicationId));
    if (w) { w.regular += s.regularHours; w.overtime += s.overtimeHours; }
  }
  const workers = [...people.values()];
  const siteJobs = await ctx.tdb.job.findMany({ where: { applications: { some: assignmentWhere } }, orderBy: { title: 'asc' },
    select: { id: true, title: true, location: true, siteLat: true, siteLng: true, geofenceMeters: true, client: { select: { name: true } } } });
  const total = workers.reduce((n, w) => n + w.regular + w.overtime, 0);

  return (
    <>
      <h1>Time clock</h1>
      <p className="lede">Workers clock in and out from the private link on their phone. Review punches, fix mistakes (with a reason), then fill the week’s timesheets from clocked hours.</p>
      <div className="bar weeknav">
        <Link className="btn ghost" href={`?week=${ymd(addWeeks(new Date(`${week}T00:00:00Z`), -1))}`} aria-label="Previous week">←</Link>
        <b>{fmt(addDays(week, -6))} – {fmt(week, { month: 'short', day: 'numeric', year: 'numeric' })}</b>
        <Link className="btn ghost" href={`?week=${ymd(addWeeks(new Date(`${week}T00:00:00Z`), 1))}`} aria-label="Next week">→</Link>
        {week !== thisWeek && <Link className="btn ghost sm" href="?">This week</Link>}
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: 18 }}>On the clock now <span className="muted" style={{ fontWeight: 500, fontSize: 14 }}>{openNow.length}</span></h2>
        {openNow.length ? (
          <div className="tc-now">{openNow.map((e) => {
            const long = (now.getTime() - e.clockIn.getTime()) / 3600e3 > 16;
            return <span key={e.id} className={`pill ${long ? 'r' : e.breakStartedAt ? 'a' : 'g'}`}>{e.application.candidate.name} · {e.breakStartedAt ? 'on break' : `since ${e.clockIn.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })}`}{long ? ' · missed clock-out?' : ''}</span>;
          })}</div>
        ) : <p className="muted" style={{ margin: 0 }}>Nobody is clocked in.</p>}
      </div>
      <TimeclockBoard week={week} workers={workers} totalHours={total} canEdit={canEdit(ctx)} isAdmin={ctx.role === 'OWNER' || ctx.role === 'ADMIN'}
        timesheets={hasFeature(ctx.org, 'timesheets')} timezone={tz} timezoneLabel={TIMEZONES.find(([z]) => z === tz)?.[1] ?? tz} />
      <JobSites mode={ctx.org.geofenceMode} canEdit={canEdit(ctx)} isAdmin={ctx.role === 'OWNER' || ctx.role === 'ADMIN'} defaultRadius={DEFAULT_RADIUS_M}
        jobs={siteJobs.map((j) => ({ id: j.id, label: [j.title, j.client?.name].filter(Boolean).join(' — '), address: j.location, lat: j.siteLat, lng: j.siteLng, radius: j.geofenceMeters }))} />
    </>
  );
}
