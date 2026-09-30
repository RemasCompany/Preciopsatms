import { requirePageContext, canEdit } from '@/lib/tenant';
import { labelFor } from '@/lib/records';
import ListToolbar, { pickFilters } from '@/components/ListToolbar';
import { OpenRecord, Pill } from '@/components/Records';
import { currentBranch, jobInBranch } from '@/lib/branches';
import { parsePlace, payTransparencyIssue } from '@/lib/state-rules';

const FILTERS = ['status', 'sector', 'type'];
const money = (n: number) => `$${n.toFixed(2)}`;

export default async function Jobs({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const ctx = await requirePageContext();
  const { tdb, org } = ctx;
  const q = searchParams.q?.trim();
  const active = pickFilters('jobs', FILTERS, searchParams);
  const { branch } = await currentBranch(ctx);
  const jobs = await tdb.job.findMany({
    where: { ...active, ...jobInBranch(branch), ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { location: { contains: q, mode: 'insensitive' } }, { client: { name: { contains: q, mode: 'insensitive' } } }] } : {}) } as never,
    include: { client: { select: { name: true } }, applications: { select: { stage: true } } },
    orderBy: [{ hot: 'desc' }, { createdAt: 'desc' }],
  });
  return (
    <>
      <h1>Jobs</h1>
      <p className="lede">Every open requisition, its pipeline, and the spread you earn per hour.</p>
      <p className="muted">Public careers page: <a href={`/careers/${org.slug}`}>/careers/{org.slug}</a> · Job board feed: <code>/api/public/{org.slug}/feed.xml</code></p>
      <ListToolbar kind="jobs" q={q} filters={FILTERS} active={active} canEdit={canEdit(ctx)} placeholder="Search title, location or client…" />
      {jobs.length ? (
        <div className="tablewrap"><table><thead><tr><th>Job</th><th>Sector</th><th>Location</th><th>Openings</th><th>Pipeline</th><th>Spread</th><th>Status</th></tr></thead><tbody>
          {jobs.map((j) => {
            const pay = Number(j.payRate ?? 0), bill = Number(j.billRate ?? 0), spread = bill - pay;
            const live = j.applications.filter((a) => a.stage !== 'REJECTED').length, placed = j.applications.filter((a) => a.stage === 'PLACED').length;
            return (
              <tr key={j.id}>
                <td><OpenRecord kind="jobs" id={j.id}><b>{j.title}</b>{j.hot && <span className="pill hot">Hot</span>}</OpenRecord><div className="muted">{j.client?.name ?? 'No client'}</div></td>
                <td>{j.sector ?? '—'}</td>
                <td>{j.location ?? '—'}<div className="muted">{labelFor('jobs', 'type', j.type)}</div>{payTransparencyIssue(j, org.showPayOnCareers) && <div className="warn" style={{ fontSize: 12.5 }} title={payTransparencyIssue(j, org.showPayOnCareers)!}>Pay must be posted in {parsePlace(j.location).state}</div>}</td>
                <td>{placed} / {j.openings} filled</td>
                <td>{live ? <a href={`/app/pipeline?job=${j.id}`}>{live} in pipeline</a> : <span className="muted">No candidates</span>}</td>
                <td>{j.billRate ? <>{money(spread)}/hr<div className="muted">{Math.round((spread / bill) * 100)}% margin</div></> : '—'}</td>
                <td><Pill s={labelFor('jobs', 'status', j.status)} /></td>
              </tr>
            );
          })}
        </tbody></table></div>
      ) : <div className="card empty"><b>{q || Object.keys(active).length ? 'No jobs match' : branch ? `No jobs in ${branch.name}` : 'No jobs yet'}</b>{q || Object.keys(active).length ? 'Try a different search or filter.' : branch ? 'Choose “All branches” at the top, or give a job this branch in its details.' : 'Add a requisition to start sourcing.'}</div>}
    </>
  );
}
