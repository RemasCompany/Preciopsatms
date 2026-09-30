import Link from 'next/link';
import { requirePageContext } from '@/lib/tenant';
import { AUDIT_GROUPS, actionLabel, auditWhere, describeChanges, type AuditFilter } from '@/lib/audit';

export const dynamic = 'force-dynamic';
const PAGE = 100;

/** Who did what, when and from where: team, settings, billing, exports, EEO, payroll and sign-ins. Owners and admins only. */
export default async function AuditLog({ searchParams }: { searchParams: AuditFilter }) {
  const ctx = await requirePageContext();
  if (ctx.role !== 'OWNER' && ctx.role !== 'ADMIN') return (<><h1>Audit log</h1><p className="card">Only owners and admins can see the audit log.</p></>);
  const f: AuditFilter = { group: searchParams.group || undefined, actor: searchParams.actor || undefined, from: searchParams.from || undefined, to: searchParams.to || undefined, before: searchParams.before || undefined };
  const [rows, people] = await Promise.all([
    ctx.tdb.auditLog.findMany({ where: auditWhere(f), orderBy: { createdAt: 'desc' }, take: PAGE + 1 }),
    ctx.tdb.auditLog.findMany({ where: { actorEmail: { not: null } }, distinct: ['actorEmail'], select: { actorEmail: true }, orderBy: { actorEmail: 'asc' }, take: 200 }),
  ]);
  const more = rows.length > PAGE, shown = rows.slice(0, PAGE);
  const qs = (extra: Partial<AuditFilter>) => new URLSearchParams(Object.entries({ ...f, ...extra }).filter(([, v]) => v) as [string, string][]).toString();
  const tz = ctx.org.timezone;
  const when = (d: Date) => d.toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <>
      <h1>Audit log</h1>
      <p className="lede">A permanent record of sign-ins, team and role changes, settings, billing, data exports, EEO access and payroll actions. Entries can’t be edited or deleted.</p>
      <form className="card filters row" method="get" style={{ flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
        <label>Type<select name="group" defaultValue={f.group ?? ''}><option value="">Everything</option>{AUDIT_GROUPS.map((g) => <option key={g}>{g}</option>)}</select></label>
        <label>Person<select name="actor" defaultValue={f.actor ?? ''}><option value="">Anyone</option>{people.map((p) => <option key={p.actorEmail!}>{p.actorEmail}</option>)}</select></label>
        <label>From<input type="date" name="from" defaultValue={f.from} /></label>
        <label>To<input type="date" name="to" defaultValue={f.to} /></label>
        <button className="btn">Filter</button>
        {(f.group || f.actor || f.from || f.to) && <Link className="btn ghost" href="/app/audit">Clear</Link>}
        <a className="btn ghost" href={`/api/audit/export?${qs({ before: undefined })}`}>Download CSV</a>
      </form>
      {shown.length ? (
        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <thead><tr><th>When ({tz.replace('_', ' ')})</th><th>Who</th><th>What happened</th><th>From</th></tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{when(r.createdAt)}</td>
                <td>{r.actorEmail ?? <span className="muted">System</span>}</td>
                <td><span className={`pill ${r.action === 'auth.login_failed' ? 'r' : ''}`}>{actionLabel(r.action)}</span> {r.summary}{r.changes ? <div className="muted" style={{ fontSize: 13 }}>{describeChanges(r.changes)}</div> : null}</td>
                <td className="muted" title={r.userAgent ?? undefined}>{r.ip ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="card muted">{f.group || f.actor || f.from || f.to ? 'Nothing matches these filters.' : 'Nothing recorded yet. Sign-ins, team changes, settings, exports and payroll actions will show up here.'}</p>}
      {more && <p><Link className="btn ghost" href={`/app/audit?${qs({ before: shown[shown.length - 1].createdAt.toISOString() })}`}>Older entries</Link></p>}
    </>
  );
}
