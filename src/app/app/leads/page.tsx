import { requirePageContext, canEdit } from '@/lib/tenant';
import { db } from '@/lib/db';
import { hasFeature } from '@/lib/plans';
import ListToolbar, { pickFilters } from '@/components/ListToolbar';
import { OpenRecord, Pill } from '@/components/Records';
import Gate from '@/components/Gate';

const FILTERS = ['status', 'industry', 'source'];
const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export default async function Leads({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'leads')) return <Gate title="Lead generation" feature="Lead tracking" />;
  const q = searchParams.q?.trim();
  const active = pickFilters('leads', FILTERS, searchParams);
  const list = await ctx.tdb.lead.findMany({
    where: { ...active, ...(q ? { OR: [{ company: { contains: q, mode: 'insensitive' } }, { contact: { contains: q, mode: 'insensitive' } }, { city: { contains: q, mode: 'insensitive' } }] } : {}) },
    orderBy: [{ nextStepAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
  });
  const members = await db.membership.findMany({ where: { organizationId: ctx.org.id }, select: { user: { select: { id: true, name: true, email: true } } } });
  const owners = new Map(members.map((m) => [m.user.id, m.user.name || m.user.email]));
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  return (
    <>
      <h1>Lead generation</h1>
      <p className="lede">Prospects to work. Score them, plan the next follow-up, and convert winners into clients.</p>
      <ListToolbar kind="leads" q={q} filters={FILTERS} active={active} canEdit={canEdit(ctx)} placeholder="Search company, contact or city…" />
      {list.length ? (
        <div className="tablewrap"><table><thead><tr><th>Company</th><th>Industry</th><th>Score</th><th>Source</th><th>Owner</th><th>Follow-up</th><th>Status</th></tr></thead><tbody>
          {list.map((l) => {
            const days = l.nextStepAt ? Math.round((l.nextStepAt.getTime() - today.getTime()) / 864e5) : null;
            return (
              <tr key={l.id}>
                <td><OpenRecord kind="leads" id={l.id}><b>{l.company}</b></OpenRecord><div className="muted">{[l.contact, l.role].filter(Boolean).join(' · ')}</div></td>
                <td>{l.industry ?? '—'}<div className="muted">{[l.size, l.city].filter(Boolean).join(' · ')}</div></td>
                <td>{l.score != null ? <span className="score" style={{ color: l.score >= 70 ? 'var(--accent)' : l.score >= 40 ? 'var(--amber)' : 'var(--muted)' }}>{l.score}</span> : <span className="muted">—</span>}</td>
                <td>{l.source ?? '—'}</td>
                <td>{l.ownerId ? owners.get(l.ownerId) ?? 'Former team member' : <span className="muted">Unassigned</span>}</td>
                <td>{l.nextStepAt ? <span className={days! < 0 ? 'warn' : days! <= 1 ? 'soon' : ''}>{fmt(l.nextStepAt)}</span> : '—'}</td>
                <td><Pill s={l.status} /></td>
              </tr>
            );
          })}
        </tbody></table></div>
      ) : <div className="card empty"><b>{q || Object.keys(active).length ? 'No leads match' : 'No leads yet'}</b>{q || Object.keys(active).length ? 'Try a different search or filter.' : 'Add companies you want to win as clients.'}</div>}
    </>
  );
}
