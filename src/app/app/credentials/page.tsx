import { requirePageContext } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { ALERT_WINDOWS, CREDENTIAL_TYPE_NAMES, credentialLabel, credentialStatus, type CredentialState } from '@/lib/credentials';
import { OpenRecord } from '@/components/Records';
import Gate from '@/components/Gate';

const SHOW = {
  attention: 'Needs attention', expired: 'Expired', expiring: 'Expiring in 30 days', next60: 'Expiring in 60 days', unverified: 'Not verified', incomplete: 'Missing details', all: 'All credentials',
} as const;
type Show = keyof typeof SHOW;
const PILL = { warn: 'r', soon: 'a', ok: 'g' } as const;
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const INACTIVE = ['Inactive', 'Do not use'];

export default async function CredentialsPage({ searchParams }: { searchParams: { show?: string; type?: string; q?: string; inactive?: string } }) {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'credentials')) return <Gate title="Credentials" feature="Credential tracking" />;
  const show: Show = searchParams.show && searchParams.show in SHOW ? (searchParams.show as Show) : 'attention';
  const type = CREDENTIAL_TYPE_NAMES.includes(searchParams.type ?? '') ? searchParams.type! : '';
  const q = searchParams.q?.trim().slice(0, 100) ?? '';
  const inactive = searchParams.inactive === '1';

  const rows = await ctx.tdb.credential.findMany({
    where: {
      ...(type ? { type } : {}),
      candidate: { ...(inactive ? {} : { status: { notIn: INACTIVE } }), ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}) },
    },
    include: { candidate: { select: { id: true, name: true, status: true } } },
    orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    take: 5000,
  });
  const all = rows.map((c) => ({ c, s: credentialStatus({ type: c.type, number: c.number, state: c.state, expiresAt: ymd(c.expiresAt), verifiedAt: c.verifiedAt?.toISOString() ?? null }) }));
  const count = (st: CredentialState) => all.filter((x) => x.s.state === st).length;
  const within60 = all.filter((x) => x.s.days !== null && x.s.days >= 0 && x.s.days <= 60).length;
  const match = (x: (typeof all)[number]) => {
    switch (show) {
      case 'attention': return x.s.state !== 'current';
      case 'next60': return x.s.days !== null && x.s.days >= 0 && x.s.days <= 60;
      case 'all': return true;
      default: return x.s.state === show;
    }
  };
  const list = all.filter(match);

  return (
    <>
      <h1>Credentials</h1>
      <p className="lede">Licenses, certifications, health records and screenings for your candidates. Recruiters get an email when one is {ALERT_WINDOWS.join(', ').replace(/, (\d+)$/, ' and $1')} days from expiring and again when it expires.</p>
      <div className="kpis" style={{ margin: '16px 0' }}>
        <a className="kpi" href="?show=expired"><b className={count('expired') ? 'warnnum' : undefined}>{count('expired')}</b><span>Expired</span></a>
        <a className="kpi" href="?show=expiring"><b>{count('expiring')}</b><span>Expiring in 30 days</span></a>
        <a className="kpi" href="?show=next60"><b>{within60}</b><span>Expiring in 60 days</span></a>
        <a className="kpi" href="?show=unverified"><b>{count('unverified')}</b><span>Not verified</span></a>
        <a className="kpi" href="?show=incomplete"><b>{count('incomplete')}</b><span>Missing details</span></a>
        <a className="kpi" href="?show=all"><b>{count('current')}</b><span>Verified & current</span></a>
      </div>
      <form className="bar" role="search">
        <input className="grow" name="q" defaultValue={q} placeholder="Search candidate…" aria-label="Search candidate" />
        <select name="show" defaultValue={show} aria-label="Show">{Object.entries(SHOW).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select name="type" defaultValue={type} aria-label="Type"><option value="">All types</option>{CREDENTIAL_TYPE_NAMES.map((t) => <option key={t}>{t}</option>)}</select>
        <label className="check" style={{ margin: 0 }}><input type="checkbox" name="inactive" value="1" defaultChecked={inactive} /> Include inactive candidates</label>
        <button className="btn ghost">Filter</button>
      </form>
      {list.length ? (
        <div className="tablewrap"><table>
          <thead><tr><th>Candidate</th><th>Credential</th><th>Number</th><th>Expires</th><th>Status</th><th>Verified</th></tr></thead>
          <tbody>{list.map(({ c, s }) => (
            <tr key={c.id}>
              <td><OpenRecord kind="candidates" id={c.candidate.id}><b>{c.candidate.name}</b></OpenRecord><div className="muted">{c.candidate.status}</div></td>
              <td>{credentialLabel(c)}</td>
              <td>{c.number ?? '—'}</td>
              <td>{c.expiresAt ? fmt(ymd(c.expiresAt)!) : '—'}</td>
              <td><span className={`pill ${PILL[s.level]}`}>{s.level === 'ok' ? 'Current' : s.text}</span></td>
              <td>{c.verifiedAt ? <>{fmt(ymd(c.verifiedAt)!)}<div className="muted">{c.verifyMethod}</div></> : <span className="muted">—</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : (
        <div className="card empty">
          <b>{all.length ? (show === 'attention' ? 'Everything is current' : 'Nothing matches') : 'No credentials yet'}</b>
          {all.length ? (show === 'attention' ? 'Every credential is verified and more than 30 days from expiring.' : 'Try a different filter.') : 'Open a candidate and add their licenses, certifications and health records under Credentials.'}
        </div>
      )}
    </>
  );
}
