import Link from 'next/link';
import { requirePageContext } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { SOON_DAYS, credentialLabel, credentialStatus } from '@/lib/credentials';
import { OpenRecord } from '@/components/Records';
import { appInBranch, currentBranch, jobInBranch } from '@/lib/branches';

export default async function Dashboard() {
  const ctx = await requirePageContext();
  const { tdb, user, org } = ctx;
  const { branch } = await currentBranch(ctx);
  const [openJobs, active, placed, recent] = await Promise.all([
    tdb.job.count({ where: { status: 'OPEN', ...jobInBranch(branch) } }),
    tdb.application.count({ where: { stage: { notIn: ['PLACED', 'REJECTED'] }, ...appInBranch(branch) } }),
    tdb.application.count({ where: { ...appInBranch(branch), stage: 'PLACED', stageChangedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } }),
    tdb.activity.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
  ]);
  // Credentials that are expired or expire within 30 days, for active candidates.
  const creds = hasFeature(org, 'credentials') ? await tdb.credential.findMany({
    where: { expiresAt: { lte: new Date(Date.now() + SOON_DAYS * 864e5) }, candidate: { status: { notIn: ['Inactive', 'Do not use'] } } },
    include: { candidate: { select: { id: true, name: true } } }, orderBy: { expiresAt: 'asc' }, take: 50,
  }) : null;
  const credIssues = creds?.map((c) => ({ c, s: credentialStatus({ type: c.type, number: c.number, state: c.state, expiresAt: c.expiresAt!.toISOString().slice(0, 10), verifiedAt: c.verifiedAt?.toISOString() ?? null }) })) ?? [];
  return (
    <>
      <h1>Welcome back, {user.name?.split(' ')[0] ?? 'there'}.</h1>
      <div className="kpis"><div className="kpi"><b>{openJobs}</b>Open jobs</div><div className="kpi"><b>{active}</b>Active submissions</div><div className="kpi"><b>{placed}</b>Placements this month</div></div>
      {creds && (
        <>
          <h2>Credentials <Link className="btn ghost sm" href="/app/credentials">View all</Link></h2>
          <div className="card">
            {credIssues.length ? (
              <div className="list">{credIssues.slice(0, 8).map(({ c, s }) => (
                <div key={c.id} className="li">
                  <OpenRecord kind="candidates" id={c.candidate.id} className="link x"><b>{c.candidate.name}</b><span className="muted">{credentialLabel(c)}</span></OpenRecord>
                  <span className={`pill ${s.state === 'expired' ? 'r' : 'a'}`}>{s.text}</span>
                </div>
              ))}{credIssues.length > 8 && <Link className="muted" href="/app/credentials?show=attention">+ {credIssues.length - 8} more</Link>}</div>
            ) : <p className="okc" style={{ margin: 0 }}>No credentials expire in the next {SOON_DAYS} days.</p>}
          </div>
        </>
      )}
      <h2>Recent activity</h2>
      <div className="card">{recent.length ? recent.map((a) => <p key={a.id}>{a.text} <span className="muted">· {a.createdAt.toLocaleString()}</span></p>) : <p className="muted">Activity appears here as your team works.</p>}</div>
    </>
  );
}
