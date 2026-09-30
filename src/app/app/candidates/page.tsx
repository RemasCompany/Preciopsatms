import { requirePageContext, canEdit } from '@/lib/tenant';
import ListToolbar, { pickFilters } from '@/components/ListToolbar';
import { OpenRecord, Pill } from '@/components/Records';
import BulkMessage from '@/components/BulkMessage';
import { reachOf } from '@/lib/bulk-messaging';
import { hasFeature } from '@/lib/plans';

const FILTERS = ['status', 'sector', 'availability', 'source'];

export default async function Candidates({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const ctx = await requirePageContext();
  const q = searchParams.q?.trim();
  const active = pickFilters('candidates', FILTERS, searchParams);
  const list = await ctx.tdb.candidate.findMany({
    where: { ...active, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { title: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { skills: { has: q } }] } : {}) },
    include: { vendor: { select: { name: true } }, _count: { select: { applications: true } } },
    orderBy: { updatedAt: 'desc' }, take: 200,
  });
  return (
    <>
      <h1>Candidates</h1>
      <p className="lede">Your talent database. Add candidates, then submit them straight to a job.</p>
      <ListToolbar kind="candidates" q={q} filters={FILTERS} active={active} canEdit={canEdit(ctx)} placeholder="Search name, title, email or exact skill…"
        extra={canEdit(ctx) && hasFeature(ctx.org, 'messaging') && <BulkMessage type="candidate" noun="candidates" ids={list.map((c) => c.id)} reach={reachOf(list)} />} />
      {list.length ? (
        <div className="tablewrap"><table><thead><tr><th>Candidate</th><th>Skills</th><th>Sector</th><th>Submissions</th><th>Availability</th><th>Source</th><th>Status</th></tr></thead><tbody>
          {list.map((c) => (
            <tr key={c.id}>
              <td><OpenRecord kind="candidates" id={c.id}><b>{c.name}</b></OpenRecord><div className="muted">{c.title}</div></td>
              <td><span className="tags">{c.skills.slice(0, 4).map((s) => <span key={s}>{s}</span>)}</span></td>
              <td>{c.sector ?? '—'}<div className="muted">{c.location}</div></td>
              <td>{c._count.applications}</td>
              <td>{c.availability ?? '—'}<div className="muted">{c.desiredRate ? `$${Number(c.desiredRate).toFixed(2)}/hr` : ''}</div></td>
              <td>{c.source ?? '—'}<div className="muted">{c.vendor?.name}</div></td>
              <td><Pill s={c.status} /></td>
            </tr>
          ))}
        </tbody></table></div>
      ) : <div className="card empty"><b>{q || Object.keys(active).length ? 'No candidates match' : 'No candidates yet'}</b>{q || Object.keys(active).length ? 'Try a different search or filter.' : 'Add your first candidate, or share your careers page to start collecting applicants.'}</div>}
    </>
  );
}
