import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FILTERS, accounts, inFilter, isFilter, metrics, platformAdmin, type Filter } from '@/lib/platform';
import SignOutButton from '@/components/SignOutButton';

export const dynamic = 'force-dynamic';

const day = (d: Date | null) => (d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—');
const ago = (d: Date, now: Date) => { const n = Math.floor((now.getTime() - d.getTime()) / 864e5); return n <= 0 ? 'Today' : n === 1 ? 'Yesterday' : `${n} days ago`; };
const PILL: Record<string, string> = { trial: 'a', expired: 'r', paying: 'g', past_due: 'r', cancelled: '', complimentary: 'g' };

/** Preciops' own console: every customer company, where it stands, and who to call. Read-only. */
export default async function Platform({ searchParams }: { searchParams: { filter?: string; q?: string } }) {
  const admin = await platformAdmin();
  if (!admin) notFound();
  if ('setup' in admin) return (
    <>
      <h1>Platform console</h1>
      <p className="lede">Signed in as {admin.email}. This console reaches every customer company, so it needs two more steps first:</p>
      <ul>{admin.setup.map((s) => <li key={s}>{s}</li>)}</ul>
      <p><Link className="btn" href="/app/account">Go to My sign-in</Link></p>
    </>
  );
  const now = new Date();
  const filter: Filter = isFilter(searchParams.filter) ? searchParams.filter : 'all';
  const q = searchParams.q?.trim().slice(0, 100) ?? '';
  const [everyone, m] = await Promise.all([accounts({ q }, now), metrics(now)]);
  const rows = everyone.filter((r) => inFilter(r, filter, now));
  const href = (f: Filter) => `/platform?${new URLSearchParams({ ...(f !== 'all' ? { filter: f } : {}), ...(q ? { q } : {}) })}`;
  const money = (c: number | null) => (c === null ? '—' : (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
  return (
    <>
      <div className="bar" style={{ alignItems: 'center' }}>
        <div><h1 style={{ margin: 0 }}>Platform console</h1><p className="muted" style={{ margin: 0 }}>Every company on Preciops. Signed in as {admin.email}.</p></div>
        <span className="grow" />
        <Link className="btn ghost sm" href="/app">Back to the app</Link><SignOutButton />
      </div>
      <div className="kpis" style={{ marginTop: 16 }}>
        <div className="kpi"><b>{m.total}</b><span>Companies ({m.week} new this week, {m.month} this month)</span></div>
        <div className="kpi"><b>{m.trials}</b><span>On trial{m.ending ? ` · ${m.ending} ending in 3 days` : ''}</span></div>
        <div className="kpi"><b className={m.expired ? 'warnnum' : undefined}>{m.expired}</b><span>Trial ended, no plan</span></div>
        <div className="kpi"><b>{m.paying}</b><span>Paying{m.pastDue ? ` · ${m.pastDue} past due` : ''}</span></div>
        <div className="kpi"><b>{m.conversion ? `${Math.round(m.conversion.rate * 100)}%` : '—'}</b><span>Trial to paid{m.conversion ? ` (${m.conversion.of} trials, last 90 days)` : ''}</span></div>
        <div className="kpi"><b>{money(m.mrrCents)}</b><span>Monthly revenue (Stripe)</span></div>
      </div>
      <form className="row" style={{ margin: '16px 0 8px' }} role="search">
        {filter !== 'all' && <input type="hidden" name="filter" value={filter} />}
        <input name="q" defaultValue={q} placeholder="Search company or owner email" aria-label="Search companies" style={{ flex: '1 1 240px' }} />
        <button className="btn ghost">Search</button>
        {q && <Link className="btn ghost" href={href('all')}>Clear</Link>}
        <a className="btn ghost" href={`/api/platform/accounts?${new URLSearchParams({ ...(filter !== 'all' ? { filter } : {}), ...(q ? { q } : {}) })}`}>Export CSV</a>
      </form>
      <nav className="tabs" aria-label="Filter companies" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0 12px' }}>
        {(Object.keys(FILTERS) as Filter[]).map((f) => {
          const n = everyone.filter((r) => inFilter(r, f, now)).length;
          return <Link key={f} href={href(f)} className={`btn sm ${f === filter ? '' : 'ghost'}`} aria-current={f === filter ? 'page' : undefined}>{FILTERS[f]} ({n})</Link>;
        })}
      </nav>
      {!rows.length ? <p className="muted">No companies here{q ? ` matching “${q}”` : ''}.</p> : (
        <table>
          <thead><tr><th>Company</th><th>Standing</th><th>Plan</th><th>Owner</th><th>Users</th><th>Employees</th><th>Signed up</th><th>Last active</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><b>{r.name}</b><div className="muted" style={{ fontSize: 13 }}>{r.kind === 'EMPLOYER' ? 'Employer' : 'Staffing agency'}{r.industry === 'HEALTHCARE' ? ' · Healthcare' : ''}</div></td>
              <td><span className={`pill ${PILL[r.standing] ?? ''}`}>{r.standingLabel}</span>{r.trialEndsAt && (r.standing === 'trial' || r.standing === 'expired') && <div className="muted" style={{ fontSize: 13 }}>{r.standing === 'expired' ? 'Ended' : 'Ends'} {day(r.trialEndsAt)}</div>}</td>
              <td>{r.planName}</td>
              <td>{r.owner ? <>{r.owner.name}<div style={{ fontSize: 13 }}><a href={`mailto:${r.owner.email}`}>{r.owner.email}</a></div></> : <span className="muted">No owner</span>}</td>
              <td>{r.users}</td><td>{r.employees}</td>
              <td>{day(r.created)}</td><td>{ago(r.lastActive, now)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <p className="muted" style={{ marginTop: 16 }}>Trials that end without a plan become read-only automatically, after emails to the owner 3 days and 1 day before. Paying customers’ billing is in Stripe.</p>
    </>
  );
}
