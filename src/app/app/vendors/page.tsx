import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { vendorCompliance } from '@/lib/records';
import ListToolbar, { pickFilters } from '@/components/ListToolbar';
import { OpenRecord, Pill } from '@/components/Records';
import Gate from '@/components/Gate';

const FILTERS = ['status', 'category'];
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export default async function Vendors({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'vendors')) return <Gate title="Vendors" feature="Vendor management" />;
  const q = searchParams.q?.trim();
  const active = pickFilters('vendors', FILTERS, searchParams);
  const list = await ctx.tdb.vendor.findMany({
    where: { ...active, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { contact: { contains: q, mode: 'insensitive' } }] } : {}) },
    include: { candidates: { select: { applications: { where: { stage: 'PLACED' }, select: { id: true } } } } },
    orderBy: { name: 'asc' },
  });
  return (
    <>
      <h1>Vendors</h1>
      <p className="lede">Suppliers and partners, what they’ve delivered, and whether their paperwork is current.</p>
      <ListToolbar kind="vendors" q={q} filters={FILTERS} active={active} canEdit={canEdit(ctx)} placeholder="Search vendor or contact…" />
      {list.length ? (
        <div className="tablewrap"><table><thead><tr><th>Vendor</th><th>Category</th><th>Candidates supplied</th><th>Rating</th><th>Compliance</th><th>Status</th></tr></thead><tbody>
          {list.map((v) => {
            const issues = vendorCompliance({ coiExpiresAt: ymd(v.coiExpiresAt), agreementExpiresAt: ymd(v.agreementExpiresAt), w9ReceivedAt: ymd(v.w9ReceivedAt) });
            const rating = v.rating == null ? null : Number(v.rating);
            return (
              <tr key={v.id}>
                <td><OpenRecord kind="vendors" id={v.id}><b>{v.name}</b></OpenRecord><div className="muted">{v.contact}</div></td>
                <td>{v.category ?? '—'}</td>
                <td>{v.candidates.length}<div className="muted">{v.candidates.filter((c) => c.applications.length).length} placed</div></td>
                <td>{rating ? <><span aria-hidden="true">{'★'.repeat(Math.round(rating))}</span> <span className="muted">{rating.toFixed(1)}</span></> : '—'}</td>
                <td>{issues.length ? issues.map((i) => <div key={i.text} className={i.level}>{i.text}</div>) : <span className="okc">Compliant</span>}</td>
                <td><Pill s={v.status} /></td>
              </tr>
            );
          })}
        </tbody></table></div>
      ) : <div className="card empty"><b>{q || Object.keys(active).length ? 'No vendors match' : 'No vendors yet'}</b>{q || Object.keys(active).length ? 'Try a different search or filter.' : 'Add sub-vendors, screening providers and other partners to track their compliance.'}</div>}
    </>
  );
}
