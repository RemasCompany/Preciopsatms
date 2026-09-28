import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import ListToolbar, { pickFilters } from '@/components/ListToolbar';
import { OpenRecord, Pill } from '@/components/Records';
import Gate from '@/components/Gate';

const FILTERS = ['status', 'industry'];
const OPEN_DEAL = { notIn: ['Won', 'Lost'] };

export default async function Clients({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'crm')) return <Gate title="Clients & contacts" feature="CRM" />;
  const q = searchParams.q?.trim();
  const active = pickFilters('clients', FILTERS, searchParams);
  const list = await ctx.tdb.client.findMany({
    where: { ...active, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { city: { contains: q, mode: 'insensitive' } }, { contacts: { some: { name: { contains: q, mode: 'insensitive' } } } }] } : {}) },
    include: {
      contacts: { select: { name: true }, orderBy: { name: 'asc' }, take: 1 },
      jobs: { select: { status: true, applications: { where: { stage: 'PLACED' }, select: { id: true } } } },
      deals: { where: { stage: OPEN_DEAL }, select: { value: true } },
    },
    orderBy: { name: 'asc' },
  });
  return (
    <>
      <h1>Clients & contacts</h1>
      <p className="lede">Accounts you staff for, their contacts, open jobs and deals.</p>
      <ListToolbar kind="clients" q={q} filters={FILTERS} active={active} canEdit={canEdit(ctx)} placeholder="Search company, city or contact…" />
      {list.length ? (
        <div className="tablewrap"><table><thead><tr><th>Client</th><th>Industry</th><th>Open jobs</th><th>Placements</th><th>Open deals</th><th>Primary contact</th><th>Status</th></tr></thead><tbody>
          {list.map((c) => (
            <tr key={c.id}>
              <td><OpenRecord kind="clients" id={c.id}><b>{c.name}</b></OpenRecord><div className="muted">{c.city}</div></td>
              <td>{c.industry ?? '—'}</td>
              <td>{c.jobs.filter((j) => j.status === 'OPEN').length}</td>
              <td>{c.jobs.reduce((n, j) => n + j.applications.length, 0)}</td>
              <td>{c.deals.reduce((s, d) => s + Number(d.value ?? 0), 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</td>
              <td>{c.contacts[0]?.name ?? '—'}</td>
              <td><Pill s={c.status} /></td>
            </tr>
          ))}
        </tbody></table></div>
      ) : <div className="card empty"><b>{q || Object.keys(active).length ? 'No clients match' : 'No clients yet'}</b>{q || Object.keys(active).length ? 'Try a different search or filter.' : 'Add the companies you staff for, or convert a qualified lead.'}</div>}
    </>
  );
}
