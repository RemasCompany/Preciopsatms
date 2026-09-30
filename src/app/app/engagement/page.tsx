import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { assignmentWhere } from '@/lib/schedule-server';
import { localDate } from '@/lib/timeclock';
import { RECOGNITION_KINDS, milestoneLabel, milestonesFor, summarize, upcomingBirthdays, type RecognitionKind } from '@/lib/engagement';
import EngagementBoard, { type EngWorker } from '@/components/EngagementBoard';
import Gate from '@/components/Gate';

export const dynamic = 'force-dynamic';
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export default async function Engagement() {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'engagement')) return <Gate title="Engagement" feature="Birthdays, recognition and feedback" />;
  const tz = ctx.org.timezone, today = localDate(new Date(), tz);
  const since = new Date(Date.now() - 90 * 864e5);
  const [apps, feedback, recognitions] = await Promise.all([
    ctx.tdb.application.findMany({ where: assignmentWhere, include: { candidate: { select: { id: true, name: true, email: true, phone: true, emailOptOut: true, smsOptOut: true, birthMonth: true, birthDay: true } }, job: { select: { title: true, clientId: true, client: { select: { name: true, contacts: { select: { id: true, name: true, email: true } } } } } } }, orderBy: { candidate: { name: 'asc' } } }),
    ctx.tdb.feedback.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 200 }),
    ctx.tdb.recognition.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  const names = new Map<string, string>();
  const allIds = [...new Set([...feedback.map((f) => f.candidateId), ...recognitions.map((r) => r.candidateId)])];
  if (allIds.length) for (const c of await ctx.tdb.candidate.findMany({ where: { id: { in: allIds } }, select: { id: true, name: true } })) names.set(c.id, c.name);
  for (const a of apps) names.set(a.candidate.id, a.candidate.name);

  const workers: EngWorker[] = apps.map((a) => {
    const fb = feedback.filter((f) => f.candidateId === a.candidateId);
    return {
      applicationId: a.id, candidateId: a.candidate.id, name: a.candidate.name, job: [a.job.title, a.job.client?.name].filter(Boolean).join(' — '),
      canText: !!a.candidate.phone && !a.candidate.smsOptOut, canEmail: !!a.candidate.email && !a.candidate.emailOptOut,
      birthMonth: a.candidate.birthMonth, birthDay: a.candidate.birthDay, placedOn: ymd(a.stageChangedAt),
      contacts: (a.job.client?.contacts ?? []).filter((c) => c.email).map((c) => ({ id: c.id, name: c.name })),
      workerAvg: summarize(fb.filter((f) => f.source === 'WORKER').map((f) => f.rating)).average,
      clientAvg: summarize(fb.filter((f) => f.source !== 'WORKER').map((f) => f.rating)).average,
    };
  });
  const seen = new Set<string>();
  const birthdays = upcomingBirthdays(workers.filter((w) => !seen.has(w.candidateId) && seen.add(w.candidateId)), today, 30);
  const milestones = workers.flatMap((w) => milestonesFor(w.placedOn, today).map((m) => ({ w, ...m })))
    .filter(({ w, days }) => !recognitions.some((r) => r.candidateId === w.candidateId && r.kind === 'milestone' && r.message.includes(milestoneLabel(days))))
    .sort((a, b) => a.inDays - b.inDays);
  const worker30 = summarize(feedback.filter((f) => f.source === 'WORKER' && f.createdAt.getTime() > Date.now() - 30 * 864e5).map((f) => f.rating));
  const client90 = summarize(feedback.filter((f) => f.source !== 'WORKER').map((f) => f.rating));
  const lowWorker = feedback.filter((f) => f.source === 'WORKER' && f.rating <= 2 && f.createdAt.getTime() > Date.now() - 30 * 864e5);
  const noRehire = feedback.filter((f) => f.wouldRehire === false);

  return (
    <>
      <h1>Engagement</h1>
      <p className="lede">Keep workers on assignment happy and coming back: celebrate birthdays and milestones, recognize great work, and hear how assignments are going from workers and clients.</p>
      <div className="kpis" style={{ margin: '16px 0' }}>
        <div className="kpi"><b>{worker30.average ?? '—'}</b><span>Worker pulse (30 days)</span><span className="sub">{worker30.count} response{worker30.count === 1 ? '' : 's'}</span></div>
        <div className="kpi"><b>{client90.average ?? '—'}</b><span>Client rating (90 days)</span><span className="sub">{client90.count} rating{client90.count === 1 ? '' : 's'}</span></div>
        <div className="kpi"><b className={lowWorker.length ? 'warnnum' : undefined}>{lowWorker.length}</b><span>Unhappy workers</span><span className="sub">rated 1–2 in 30 days</span></div>
        <div className="kpi"><b className={noRehire.length ? 'warnnum' : undefined}>{noRehire.length}</b><span>“Wouldn’t have back”</span><span className="sub">last 90 days</span></div>
        <div className="kpi"><b>{recognitions.filter((r) => r.createdAt.getTime() > Date.now() - 30 * 864e5).length}</b><span>Recognitions (30 days)</span></div>
      </div>
      <div className="grid2">
        <section className="card">
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Birthdays — next 30 days</h2>
          {birthdays.length ? <div className="list">{birthdays.map((b) => (
            <div key={b.candidateId} className="li"><div className="x"><b>{b.name}</b><span className="muted">{b.job}</span></div><span className={`pill ${b.inDays === 0 ? 'g' : ''}`}>{b.inDays === 0 ? '🎂 Today' : b.inDays === 1 ? 'Tomorrow' : fmt(b.date)}</span></div>
          ))}</div> : <p className="muted" style={{ margin: 0 }}>No birthdays coming up. Workers can add theirs from their private link, or you can add it below.</p>}
        </section>
        <section className="card">
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Milestones to celebrate</h2>
          {milestones.length ? <div className="list">{milestones.map((m) => (
            <div key={`${m.w.applicationId}-${m.days}`} className="li"><div className="x"><b>{m.w.name}</b><span className="muted">{milestoneLabel(m.days)} on assignment · {m.w.job}</span></div><span className="pill">{m.inDays === 0 ? 'Today' : m.inDays < 0 ? `${-m.inDays}d ago` : `in ${m.inDays}d`}</span></div>
          ))}</div> : <p className="muted" style={{ margin: 0 }}>No 30-, 90-, 180-day or yearly milestones in the next two weeks.</p>}
        </section>
      </div>
      <EngagementBoard workers={workers} canEdit={canEdit(ctx)} isAdmin={ctx.role === 'OWNER' || ctx.role === 'ADMIN'} birthdayGreetings={ctx.org.birthdayGreetings}
        milestones={milestones.map((m) => ({ applicationId: m.w.applicationId, label: milestoneLabel(m.days) }))}
        feedback={feedback.slice(0, 40).map((f) => ({ id: f.id, name: names.get(f.candidateId) ?? 'Former worker', source: f.source, rating: f.rating, wouldRehire: f.wouldRehire, comment: f.comment, author: f.authorName, at: f.createdAt.toISOString() }))}
        recognitions={recognitions.slice(0, 20).map((r) => ({ id: r.id, name: names.get(r.candidateId) ?? 'Former worker', kind: r.kind as RecognitionKind, label: RECOGNITION_KINDS[r.kind as RecognitionKind]?.label ?? 'Kudos', message: r.message, at: r.createdAt.toISOString(), notified: !!r.notifiedAt }))} />
    </>
  );
}
