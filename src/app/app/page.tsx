import Link from 'next/link';
import { requirePageContext } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { SOON_DAYS, credentialLabel, credentialStatus } from '@/lib/credentials';
import { OpenRecord } from '@/components/Records';
import { appInBranch, currentBranch, jobInBranch } from '@/lib/branches';
import { jobReadiness } from '@/lib/requirements-server';

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
  const people = hasFeature(org, 'people') ? {
    active: await tdb.employee.count({ where: { status: 'ACTIVE' } }), leave: await tdb.employee.count({ where: { status: 'ON_LEAVE' } }),
  } : null;
  // Credentials that are expired or expire within 30 days, for active candidates.
  const creds = hasFeature(org, 'credentials') ? await tdb.credential.findMany({
    where: { expiresAt: { lte: new Date(Date.now() + SOON_DAYS * 864e5) }, candidate: { status: { notIn: ['Inactive', 'Do not use'] } } },
    include: { candidate: { select: { id: true, name: true } } }, orderBy: { expiresAt: 'asc' }, take: 50,
  }) : null;
  // Healthcare: what stands between people and their next shift, first thing.
  const care = org.industry === 'HEALTHCARE' && hasFeature(org, 'credentials') ? await (async () => {
    const [jobs, matches, waiting, stale] = await Promise.all([
      jobReadiness(tdb, org),
      tdb.exclusionMatch.count({ where: { status: 'OPEN' } }),
      tdb.skillsChecklist.count({ where: { status: 'SENT' } }),
      tdb.skillsChecklist.count({ where: { status: 'COMPLETED', expiresAt: { lt: new Date() } } }),
    ]);
    const workers = jobs.flatMap((j) => j.workers);
    return { notCleared: workers.filter((w) => w.gaps.length).length, workers: workers.length, matches, waiting, stale, screening: org.exclusionScreening };
  })() : null;
  const credIssues = creds?.map((c) => ({ c, s: credentialStatus({ type: c.type, number: c.number, state: c.state, expiresAt: c.expiresAt!.toISOString().slice(0, 10), verifiedAt: c.verifiedAt?.toISOString() ?? null }) })) ?? [];
  return (
    <>
      <h1>Welcome back, {user.name?.split(' ')[0] ?? 'there'}.</h1>
      {org.kind === 'EMPLOYER'
        ? <div className="kpis"><div className="kpi"><b>{openJobs}</b>Open jobs</div><div className="kpi"><b>{active}</b>Candidates in process</div><div className="kpi"><b>{placed}</b>Hires this month</div>
            {people && <><Link className="kpi" href="/app/employees"><b>{people.active}</b>Employees</Link><Link className="kpi" href="/app/employees?status=ON_LEAVE"><b>{people.leave}</b>On leave</Link></>}</div>
        : <div className="kpis"><div className="kpi"><b>{openJobs}</b>Open jobs</div><div className="kpi"><b>{active}</b>Active submissions</div><div className="kpi"><b>{placed}</b>Placements this month</div></div>}
      {care && (
        <>
          <h2>Healthcare compliance</h2>
          <div className="kpis">
            <Link className="kpi" href="/app/credentials/requirements"><b className={care.notCleared ? 'warnnum' : undefined}>{care.notCleared}</b>Not cleared for their job<span className="sub">of {care.workers} on assignment</span></Link>
            <Link className="kpi" href="/app/credentials?show=expired"><b className={credIssues.some((x) => x.s.state === 'expired') ? 'warnnum' : undefined}>{credIssues.filter((x) => x.s.state === 'expired').length}</b>Expired credentials</Link>
            <Link className="kpi" href="/app/credentials/exclusions"><b className={care.matches ? 'warnnum' : undefined}>{care.screening ? care.matches : 'Off'}</b>{care.screening ? 'Exclusion matches to review' : 'Exclusion screening'}</Link>
            <Link className="kpi" href="/app/credentials/checklists?show=waiting"><b>{care.waiting}</b>Skills checklists waiting{care.stale ? <span className="sub">{care.stale} over a year old</span> : null}</Link>
          </div>
        </>
      )}
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
