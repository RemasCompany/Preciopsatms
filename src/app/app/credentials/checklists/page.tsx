import { requirePageContext } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { SKILLS_CHECKLISTS, summarize } from '@/lib/skills-checklists';
import { OpenRecord } from '@/components/Records';
import Gate from '@/components/Gate';
import CredentialTabs from '@/components/CredentialTabs';

const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export default async function ChecklistsPage({ searchParams }: { searchParams: { show?: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'credentials')) return <Gate title="Credentials" feature="Credential tracking" />;
  const show = ['waiting', 'expired'].includes(searchParams.show ?? '') ? searchParams.show! : 'all';
  const rows = await ctx.tdb.skillsChecklist.findMany({ where: { status: { not: 'CANCELLED' } }, include: { candidate: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 1000 });
  const now = new Date();
  const list = rows.filter((r) => show === 'all' || (show === 'waiting' ? r.status === 'SENT' : !!r.expiresAt && r.expiresAt < now));
  return (
    <>
      <h1>Credentials</h1>
      <CredentialTabs at="/app/credentials/checklists" />
      <p className="lede">Clinicians rate their own experience with each skill for a specialty, on their phone, and sign. Facilities expect one with every submittal, no more than a year old. Send one from a candidate’s record under Skills checklists.</p>
      <div className="kpis" style={{ margin: '16px 0' }}>
        <a className="kpi" href="?show=all"><b>{rows.filter((r) => r.status === 'COMPLETED').length}</b><span>Completed</span></a>
        <a className="kpi" href="?show=waiting"><b>{rows.filter((r) => r.status === 'SENT').length}</b><span>Waiting on the worker</span></a>
        <a className="kpi" href="?show=expired"><b>{rows.filter((r) => r.expiresAt && r.expiresAt < now).length}</b><span>Over a year old</span></a>
      </div>
      {list.length ? <div className="tablewrap"><table>
        <thead><tr><th>Worker</th><th>Checklist</th><th>Status</th><th>Average</th><th></th></tr></thead>
        <tbody>{list.map((r) => {
          const s = r.answers ? summarize(r.specialty, r.answers as Record<string, number>) : null;
          const expired = !!r.expiresAt && r.expiresAt < now;
          return (
            <tr key={r.id}>
              <td><OpenRecord kind="candidates" id={r.candidate.id}><b>{r.candidate.name}</b></OpenRecord></td>
              <td>{SKILLS_CHECKLISTS[r.specialty]?.title ?? r.specialty}</td>
              <td>{r.status === 'SENT' ? <span className="pill a">Sent {fmt(r.createdAt)}</span> : <span className={`pill ${expired ? 'r' : 'g'}`}>{expired ? 'Expired' : 'Completed'} {fmt(r.completedAt!)}</span>}</td>
              <td>{s?.average != null ? `${s.average} of 4` : '—'}{s?.needsSupport.length ? <div className="muted">{s.needsSupport.length} rated 1–2</div> : null}</td>
              <td>{r.status === 'COMPLETED' && <a href={`/app/credentials/checklists/${r.id}`} target="_blank" rel="noreferrer">Open / print</a>}</td>
            </tr>
          );
        })}</tbody>
      </table></div> : <div className="card empty"><b>{rows.length ? 'Nothing matches' : 'No checklists yet'}</b>{rows.length ? 'Try a different filter.' : 'Open a candidate and send a skills checklist from their record.'}</div>}
    </>
  );
}
