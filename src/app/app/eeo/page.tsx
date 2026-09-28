import { requirePageContext } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { buildEeoReport, EEO_DIMENSIONS, EEO_LABELS } from '@/lib/eeo';
import Gate from '@/components/Gate';

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default async function Eeo({ searchParams }: { searchParams: { job?: string; year?: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'eeo')) return <Gate title="EEO reporting" feature="EEO and OFCCP reporting" />;
  if (ctx.role !== 'OWNER' && ctx.role !== 'ADMIN') return (
    <><h1>EEO reporting</h1><div className="card empty"><b>Restricted</b>Self-identification data and EEO reports are visible only to owners and admins.</div></>
  );
  const { tdb } = ctx;
  const [jobs, first] = await Promise.all([
    tdb.job.findMany({ select: { id: true, title: true }, orderBy: { title: 'asc' } }),
    tdb.application.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
  ]);
  const jobId = jobs.some((j) => j.id === searchParams.job) ? searchParams.job : undefined;
  const thisYear = new Date().getUTCFullYear();
  const years = Array.from({ length: thisYear - (first?.createdAt.getUTCFullYear() ?? thisYear) + 1 }, (_, i) => thisYear - i);
  const year = years.includes(Number(searchParams.year)) ? Number(searchParams.year) : undefined;
  const r = await buildEeoReport(tdb, { jobId, year });
  const qs = new URLSearchParams({ ...(jobId ? { job: jobId } : {}), ...(year ? { year: String(year) } : {}) }).toString();
  const reasons = Object.entries(r.dispositionReasons).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <h1>EEO reporting</h1>
      <p className="lede">Applicant flow and adverse impact using the four-fifths rule, built from voluntary self-identification and every pipeline decision.</p>
      <form className="bar">
        <select name="job" defaultValue={jobId ?? ''} aria-label="Job"><option value="">All jobs</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}</select>
        <select name="year" defaultValue={year ?? ''} aria-label="Year"><option value="">All years</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <button className="btn ghost">Apply</button>
        <span className="grow" />
        <a className="btn ghost" href={`/api/eeo/export${qs ? `?${qs}` : ''}`}>Export applicant flow log</a>
      </form>
      <div className="kpis">
        <div className="kpi"><b>{r.applicants}</b><span>Applicants</span></div>
        <div className="kpi"><b>{pct(r.selfIdRate)}</b><span>Self-ID response rate</span></div>
        <div className="kpi"><b>{r.hired}</b><span>Hired</span></div>
        <div className="kpi"><b className={r.missingReason ? 'warnnum' : undefined}>{r.missingReason}</b><span>Rejections missing a reason</span></div>
      </div>
      <div className="grid2">
        {EEO_DIMENSIONS.map((dim) => {
          const rows = r.report[dim];
          return (
            <section key={dim} className="card">
              <h2 style={{ marginTop: 0 }}>{EEO_LABELS[dim]}</h2>
              {rows.length ? (
                <div className="tablewrap"><table style={{ minWidth: 520 }}><thead><tr><th>Group</th><th>Applicants</th><th>Interviewed</th><th>Hired</th><th>Selection rate</th><th>Impact ratio</th></tr></thead><tbody>
                  {rows.map((g) => (
                    <tr key={g.group}><td>{g.group}</td><td>{g.applicants}</td><td>{g.interviewed}</td><td>{g.hired}</td><td>{pct(g.selectionRate)}</td>
                      <td className={g.flagged ? 'warn' : undefined}>{g.impactRatio === null ? '—' : g.impactRatio.toFixed(2)}{g.flagged && ' · below 4/5ths'}</td></tr>
                  ))}
                </tbody></table></div>
              ) : <p className="muted">No self-ID data for this group of applicants yet.</p>}
            </section>
          );
        })}
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Disposition reasons</h2>
          <div className="list">
            {reasons.map(([k, n]) => <div key={k} className="li"><span>{k}</span><b>{n}</b></div>)}
            {r.missingReason > 0 && <div className="li"><span className="warn">Missing reason</span><b>{r.missingReason}</b></div>}
            {!reasons.length && !r.missingReason && <p className="muted">No rejections recorded.</p>}
          </div>
        </section>
      </div>
      <p className="muted" style={{ marginTop: 14 }}>An impact ratio below 0.80 is a signal to review that step, not a legal finding. This supports the applicant-flow records OFCCP and EEOC expect; it is not an affirmative action plan. Review results with employment counsel.</p>
    </>
  );
}
