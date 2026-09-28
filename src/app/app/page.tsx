import { requirePageContext } from '@/lib/tenant';

export default async function Dashboard() {
  const { tdb, user } = await requirePageContext();
  const [openJobs, active, placed, recent] = await Promise.all([
    tdb.job.count({ where: { status: 'OPEN' } }),
    tdb.application.count({ where: { stage: { notIn: ['PLACED', 'REJECTED'] } } }),
    tdb.application.count({ where: { stage: 'PLACED', stageChangedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } }),
    tdb.activity.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
  ]);
  return (
    <>
      <h1>Welcome back, {user.name?.split(' ')[0] ?? 'there'}.</h1>
      <div className="kpis"><div className="kpi"><b>{openJobs}</b>Open jobs</div><div className="kpi"><b>{active}</b>Active submissions</div><div className="kpi"><b>{placed}</b>Placements this month</div></div>
      <h2>Recent activity</h2>
      <div className="card">{recent.length ? recent.map((a) => <p key={a.id}>{a.text} <span className="muted">· {a.createdAt.toLocaleString()}</span></p>) : <p className="muted">Activity appears here as your team works.</p>}</div>
    </>
  );
}
