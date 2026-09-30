import { requirePageContext } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { OpenRecord } from '@/components/Records';
import { localDate, localTime, workedMinutes } from '@/lib/timeclock';
import { shiftHours, dayLabel, clock } from '@/lib/schedule';
import { DAILY_OT, MEAL_BREAKS, NOTICE_DAYS, PAY_TRANSPARENCY, dailyOtIssue, fairWorkweek, mealBreakIssue, parsePlace, payTransparencyIssue } from '@/lib/state-rules';

export const dynamic = 'force-dynamic';
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** State and city rules that touch your jobs: postings without pay, late schedule changes, missed meal breaks, daily overtime. */
export default async function Compliance() {
  const ctx = await requirePageContext();
  const { tdb, org } = ctx;
  if (ctx.role !== 'OWNER' && ctx.role !== 'ADMIN') return (<><h1>Compliance</h1><p className="card">Only owners and admins can see this page.</p></>);
  const today = localDate(new Date(), org.timezone), since = new Date(Date.now() - 14 * 864e5);
  const [jobs, shifts, entries] = await Promise.all([
    tdb.job.findMany({ where: { status: 'OPEN' }, select: { id: true, title: true, location: true, publish: true, status: true, payRate: true, client: { select: { name: true } } }, orderBy: { title: 'asc' } }),
    hasFeature(org, 'scheduling') ? tdb.shift.findMany({ where: { cancelled: false, date: { gte: new Date(`${today}T00:00:00Z`), lte: new Date(Date.now() + NOTICE_DAYS * 864e5) } },
      select: { id: true, date: true, start: true, end: true, breakMinutes: true, updatedAt: true, createdAt: true, application: { select: { candidate: { select: { name: true } }, job: { select: { title: true, location: true } } } } }, orderBy: [{ date: 'asc' }, { start: 'asc' }] }) : [],
    hasFeature(org, 'timeclock') ? tdb.timeEntry.findMany({ where: { clockIn: { gte: since }, clockOut: { not: null } }, select: { id: true, clockIn: true, clockOut: true, breakMinutes: true, application: { select: { candidate: { select: { name: true } }, job: { select: { title: true, location: true } } } } }, orderBy: { clockIn: 'desc' } }) : [],
  ]);
  const postings = jobs.map((j) => ({ j, issue: payTransparencyIssue(j, org.showPayOnCareers) })).filter((x) => x.issue);
  // A shift inside the notice window counts if it was created or last changed less than NOTICE_DAYS before its date.
  const late = shifts.filter((s) => fairWorkweek(parsePlace(s.application.job.location)) && (Date.parse(`${ymd(s.date)}T00:00:00Z`) - s.updatedAt.getTime()) / 864e5 < NOTICE_DAYS);
  const meals = entries.map((e) => ({ e, issue: mealBreakIssue(parsePlace(e.application.job.location).state, Math.round(workedMinutes({ clockIn: e.clockIn, clockOut: e.clockOut, breakMinutes: e.breakMinutes })), e.breakMinutes) })).filter((x) => x.issue);
  const daily = entries.map((e) => ({ e, issue: dailyOtIssue(parsePlace(e.application.job.location).state, workedMinutes({ clockIn: e.clockIn, clockOut: e.clockOut, breakMinutes: e.breakMinutes }) / 60) })).filter((x) => x.issue);
  const states = [...new Set(jobs.map((j) => parsePlace(j.location).state).filter(Boolean) as string[])].sort();
  const when = (d: Date) => `${dayLabel(localDate(d, org.timezone))} ${clock(localTime(d, org.timezone))}`;
  const Section = ({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) => (
    <section className="card" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>{title} <span className={`pill ${count ? 'r' : 'g'}`} style={{ fontSize: 13 }}>{count || 'OK'}</span></h2>
      {count ? children : <p className="muted" style={{ margin: 0 }}>{empty}</p>}
    </section>
  );
  return (
    <>
      <h1>Compliance</h1>
      <p className="lede">State and city rules that touch your jobs, based on each job’s location (“City, ST”). These are flags to review, not legal advice — whether a rule applies can depend on industry and company size.</p>
      <Section title="Job postings missing required pay" count={postings.length} empty="Every posted job in a pay-transparency state shows its pay.">
        <div className="list">{postings.map(({ j, issue }) => <div key={j.id} className="li"><span className="x"><OpenRecord kind="jobs" id={j.id}><b>{j.title}</b></OpenRecord><span className="muted">{[j.location, j.client?.name].filter(Boolean).join(' · ')}</span></span><span className="warn">{issue}</span></div>)}</div>
      </Section>
      {hasFeature(org, 'scheduling') && <Section title={`Shifts set with under ${NOTICE_DAYS} days’ notice (predictive scheduling)`} count={late.length} empty="No late schedule changes in predictive-scheduling cities.">
        <div className="list">{late.map((s) => <div key={s.id} className="li"><span className="x"><b>{s.application.candidate.name}</b><span className="muted">{dayLabel(ymd(s.date))} {clock(s.start)}–{clock(s.end)} · {s.application.job.title} · {s.application.job.location}</span></span><span className="warn">{fairWorkweek(parsePlace(s.application.job.location))!.name} · set {Math.max(0, Math.round((Date.parse(`${ymd(s.date)}T00:00:00Z`) - s.updatedAt.getTime()) / 864e5))} days ahead</span></div>)}</div>
      </Section>}
      {hasFeature(org, 'timeclock') && <Section title="Missed meal breaks (last 14 days)" count={meals.length} empty="No clocked shifts past a state’s meal-break threshold without a break.">
        <div className="list">{meals.map(({ e, issue }) => <div key={e.id} className="li"><span className="x"><b>{e.application.candidate.name}</b><span className="muted">{when(e.clockIn)} · {e.application.job.title}</span></span><span className="warn">{issue}</span></div>)}</div>
      </Section>}
      {hasFeature(org, 'timeclock') && <Section title="Daily overtime (last 14 days)" count={daily.length} empty="No clocked shifts over a state’s daily overtime threshold.">
        <div className="list">{daily.map(({ e, issue }) => <div key={e.id} className="li"><span className="x"><b>{e.application.candidate.name}</b><span className="muted">{when(e.clockIn)} · {(workedMinutes({ clockIn: e.clockIn, clockOut: e.clockOut, breakMinutes: e.breakMinutes }) / 60).toFixed(2)} h · {e.application.job.title}</span></span><span className="warn">{issue}</span></div>)}</div>
      </Section>}
      <section className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Rules in the states you staff</h2>
        {states.length ? <div className="tablewrap"><table><thead><tr><th>State</th><th>Pay in postings</th><th>Meal break</th><th>Daily overtime</th></tr></thead><tbody>
          {states.map((st) => <tr key={st}><td><b>{st}</b></td><td>{PAY_TRANSPARENCY[st] ? 'Required' : '—'}</td><td>{MEAL_BREAKS[st] ? `${MEAL_BREAKS[st].minutes} min after ${MEAL_BREAKS[st].afterHours} h${MEAL_BREAKS[st].second ? ` (second after ${MEAL_BREAKS[st].second} h)` : ''}` : '—'}</td><td>{DAILY_OT[st] ? `Over ${DAILY_OT[st].after} h${DAILY_OT[st].double ? `; double over ${DAILY_OT[st].double} h` : ''}` : '—'}</td></tr>)}
        </tbody></table></div> : <p className="muted" style={{ margin: 0 }}>Add a location (“City, ST”) to your jobs to see the rules that apply.</p>}
        <p className="muted" style={{ marginBottom: 0 }}>Predictive-scheduling cities: Seattle, San Francisco, Los Angeles, Berkeley, Emeryville, Chicago, Evanston, New York City, Philadelphia, and the state of Oregon ({NOTICE_DAYS} days’ notice). Payroll here computes weekly overtime; adjust a timesheet’s overtime hours where daily overtime applies.</p>
      </section>
    </>
  );
}
