import Link from 'next/link';
import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { addWeeks, parseWeek, weekEnding } from '@/lib/weeks';
import { assignmentWhere } from '@/lib/schedule-server';
import { dayLabel, weekDays } from '@/lib/schedule';
import { credentialStatus } from '@/lib/credentials';
import ScheduleBoard, { type BoardRow } from '@/components/ScheduleBoard';
import Gate from '@/components/Gate';
import OpenShifts, { type OpenRow } from '@/components/OpenShifts';
import { clock } from '@/lib/schedule';

export const dynamic = 'force-dynamic';
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export default async function Schedule({ searchParams }: { searchParams: { week?: string; client?: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'scheduling')) return <Gate title="Schedule" feature="Shift scheduling" />;
  let week: Date;
  try { week = parseWeek(searchParams.week ?? null); } catch { week = weekEnding(); }
  const w = ymd(week), days = weekDays(w);
  const clients = await ctx.tdb.client.findMany({ where: { jobs: { some: { applications: { some: assignmentWhere } } } }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const client = clients.some((c) => c.id === searchParams.client) ? searchParams.client! : '';

  const apps = await ctx.tdb.application.findMany({
    where: { ...assignmentWhere, ...(client ? { job: { ...assignmentWhere.job, clientId: client } } : {}) },
    include: {
      candidate: { select: { id: true, name: true, email: true, phone: true, emailOptOut: true, smsOptOut: true } },
      job: { select: { title: true, client: { select: { name: true } } } },
      shifts: { where: { date: { gte: new Date(`${days[0]}T00:00:00Z`), lte: week } }, orderBy: [{ date: 'asc' }, { start: 'asc' }] },
    },
    orderBy: { candidate: { name: 'asc' } },
  });
  // Flag workers with an expired, expiring-this-week or unverified credential.
  const creds = hasFeature(ctx.org, 'credentials') && apps.length
    ? await ctx.tdb.credential.findMany({ where: { candidateId: { in: apps.map((a) => a.candidateId) } } }) : [];
  const credIssue = (candidateId: string) => {
    const mine = creds.filter((c) => c.candidateId === candidateId);
    if (mine.some((c) => c.expiresAt && ymd(c.expiresAt) <= days[6])) return 'Credential expires by this week';
    if (mine.some((c) => credentialStatus({ type: c.type, number: c.number, state: c.state, expiresAt: c.expiresAt ? ymd(c.expiresAt) : null, verifiedAt: c.verifiedAt?.toISOString() ?? null }).state !== 'current')) return 'Credential not verified';
    return null;
  };
  const rows: BoardRow[] = apps.map((a) => ({
    applicationId: a.id, candidateId: a.candidateId, worker: a.candidate.name, job: a.job.title, client: a.job.client?.name ?? null,
    email: a.candidate.email, phone: a.candidate.phone, emailOptOut: a.candidate.emailOptOut, smsOptOut: a.candidate.smsOptOut, credIssue: credIssue(a.candidateId),
    shifts: a.shifts.filter((s) => !s.cancelled || s.notifiedAt).map((s) => ({
      id: s.id, date: ymd(s.date), start: s.start, end: s.end, breakMinutes: s.breakMinutes, unit: s.unit, notes: s.notes,
      cancelled: s.cancelled, notified: s.notified, everSent: !!s.notifiedAt, response: s.response, declineReason: s.declineReason,
    })),
  }));
  const [openShifts, poolJobs] = await Promise.all([
    ctx.tdb.openShift.findMany({ where: { date: { gte: new Date(`${days[0]}T00:00:00Z`), lte: week }, ...(client ? { job: { clientId: client } } : {}) }, orderBy: [{ date: 'asc' }, { start: 'asc' }],
      include: { job: { select: { title: true } }, offers: { select: { status: true, candidateId: true } } } }),
    ctx.tdb.job.findMany({ where: { type: { not: 'DIRECT_HIRE' }, applications: { some: assignmentWhere }, ...(client ? { clientId: client } : {}) }, orderBy: { title: 'asc' },
      select: { id: true, title: true, client: { select: { name: true } }, _count: { select: { applications: { where: assignmentWhere } } } } }),
  ]);
  const names = new Map(apps.map((a) => [a.candidateId, a.candidate.name]));
  const openRows: OpenRow[] = openShifts.map((o) => ({ id: o.id, date: ymd(o.date), start: o.start, end: o.end, unit: o.unit, job: o.job.title, slots: o.slots, filled: o.filled, status: o.status,
    offered: o.offers.filter((x) => x.status !== 'CANCELLED').length, declined: o.offers.filter((x) => x.status === 'DECLINED').length,
    takers: o.offers.filter((x) => x.status === 'ACCEPTED').map((x) => names.get(x.candidateId) ?? 'a worker') }));
  // Declined shifts this week are the usual reason to post an open one.
  const declined = apps.flatMap((a) => a.shifts.filter((s) => !s.cancelled && s.notified && s.response === 'DECLINED' && ymd(s.date) >= ymd(new Date()))
    .map((s) => ({ jobId: a.jobId, date: ymd(s.date), start: s.start, end: s.end, breakMinutes: s.breakMinutes, unit: s.unit, label: `${a.candidate.name.split(' ')[0]}’s ${dayLabel(ymd(s.date))} ${clock(s.start)} shift (can’t make it)` })));
  const all = rows.flatMap((r) => r.shifts.filter((s) => !s.cancelled));
  const count = (f: (s: BoardRow['shifts'][number]) => boolean) => all.filter(f).length;
  const q = (wk: Date) => `?week=${ymd(wk)}${client ? `&client=${client}` : ''}`;
  const thisWeek = ymd(weekEnding());

  return (
    <>
      <h1>Schedule</h1>
      <p className="lede">Build each week’s shifts for workers on assignment, then publish: each worker gets one email or text with their shifts and a link to confirm them, plus a reminder the day before.</p>
      <div className="bar weeknav">
        <Link className="btn ghost" href={q(addWeeks(week, -1))} aria-label="Previous week">←</Link>
        <b>{dayLabel(days[0], { month: 'short', day: 'numeric' })} – {dayLabel(days[6], { month: 'short', day: 'numeric', year: 'numeric' })}</b>
        <Link className="btn ghost" href={q(addWeeks(week, 1))} aria-label="Next week">→</Link>
        {w !== thisWeek && <Link className="btn ghost sm" href={`?week=${thisWeek}${client ? `&client=${client}` : ''}`}>This week</Link>}
        <span className="grow" />
        {clients.length > 1 && (
          <form className="row" style={{ margin: 0 }}>
            <input type="hidden" name="week" value={w} />
            <select name="client" defaultValue={client} aria-label="Client"><option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <button className="btn ghost">Show</button>
          </form>
        )}
      </div>
      <div className="kpis">
        <div className="kpi"><b>{all.length}</b><span>Shifts this week</span></div>
        <div className="kpi"><b>{count((s) => s.notified && s.response === 'CONFIRMED')}</b><span>Confirmed</span></div>
        <div className="kpi"><b>{count((s) => s.notified && s.response === 'PENDING')}</b><span>Awaiting reply</span></div>
        <div className="kpi"><b className={count((s) => s.notified && s.response === 'DECLINED') ? 'warnnum' : undefined}>{count((s) => s.notified && s.response === 'DECLINED')}</b><span>Can’t make it</span></div>
        <div className="kpi"><b>{count((s) => !s.notified)}</b><span>Not sent yet</span></div>
      </div>
      <ScheduleBoard week={w} days={days} rows={rows} canEdit={canEdit(ctx)} today={ymd(new Date())} />
      <OpenShifts rows={openRows} declined={declined} canEdit={canEdit(ctx)} today={ymd(new Date())}
        jobs={poolJobs.map((j) => ({ id: j.id, label: [j.title, j.client?.name].filter(Boolean).join(' — '), pool: j._count.applications }))} />
    </>
  );
}
