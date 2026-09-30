'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { clockLong, dayLabel } from '@/lib/schedule';
import ResponsiveTables from '@/components/ResponsiveTables';

type Data = {
  company: string; brandColor: string; logoUrl: string | null; contactEmail: string | null; contact: { name: string }; client: { name: string; terms: string };
  jobs: { id: string; title: string; status: string; openings: number; filled: number; location: string | null; startDate: string | null; billRate: number | null }[];
  workers: { applicationId: string; name: string; job: string; since: string }[];
  timesheets: { id: string; week: string; worker: string; job: string; reg: number; ot: number; billRate: number; amount: number; approvedAt: string | null; approvedBy: string | null; dispute: string | null }[];
  shifts: { id: string; date: string; start: string; end: string; unit: string | null; confirmed: boolean; worker: string; job: string }[];
  invoices: { id: string; number: string; issued: string; due: string; total: number; balance: number; status: string; overdue: boolean }[];
};
const TABS = ['Hours', 'Schedule', 'Workers', 'Job orders', 'Invoices'] as const;
type Tab = (typeof TABS)[number];
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const STATUS: Record<string, string> = { OPEN: 'Open', ON_HOLD: 'Being reviewed', FILLED: 'Filled', CLOSED: 'Closed' };

/** The client portal: approve hours, see the schedule, rate workers, request staff and get invoices. */
export default function ClientPortal({ params }: { params: { token: string } }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('Hours');
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch(`/api/portal/${params.token}`);
    const j = await r.json().catch(() => ({}));
    if (r.ok) setData(j); else setError(j.error ?? 'This link isn’t working.');
  }, [params.token]);
  useEffect(() => { load(); }, [load]);

  async function act(body: object) {
    setBusy(true); setNote(null);
    const r = await fetch(`/api/portal/${params.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setNote(r.ok ? { text: j.message } : { text: j.error ?? 'That didn’t go through. Try again.', bad: true });
    if (r.ok) load();
    return r.ok;
  }

  if (!data) return (
    <main className="public" style={{ maxWidth: 520 }}>
      <p className={error ? 'error' : 'muted'}>{error || 'Loading…'}</p>
      {error && <p><a href="/client/login">Get a new link</a></p>}
    </main>
  );
  const toApprove = data.timesheets.filter((t) => !t.approvedAt);
  return (
    <main className="public portal" style={{ ['--accent' as string]: data.brandColor, maxWidth: 980 }}>
      <ResponsiveTables />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {data.logoUrl && /^https:\/\//.test(data.logoUrl) && <img className="careers-logo" src={data.logoUrl} alt={data.company} />}
      <p className="muted" style={{ margin: 0 }}>{data.company} · client portal</p>
      <h1>{data.client.name}</h1>
      <p className="lede">Hi {data.contact.name.split(' ')[0]}. {toApprove.length ? `${toApprove.length} timesheet${toApprove.length === 1 ? '' : 's'} waiting for your approval.` : 'You’re all caught up.'}</p>
      <nav className="row" aria-label="Portal sections" style={{ flexWrap: 'wrap', margin: '12px 0' }}>
        {TABS.map((t) => <button key={t} className={`btn ${t === tab ? '' : 'ghost'} sm`} aria-current={t === tab ? 'page' : undefined} onClick={() => { setTab(t); setNote(null); }}>{t}{t === 'Hours' && toApprove.length ? ` (${toApprove.length})` : ''}</button>)}
      </nav>
      {note && <p className={`card banner${note.bad ? ' error' : ''}`} role="status">{note.text}</p>}
      {tab === 'Hours' && <Hours data={data} busy={busy} act={act} />}
      {tab === 'Schedule' && <Schedule shifts={data.shifts} />}
      {tab === 'Workers' && <Workers workers={data.workers} busy={busy} act={act} />}
      {tab === 'Job orders' && <Jobs jobs={data.jobs} busy={busy} act={act} />}
      {tab === 'Invoices' && <Invoices token={params.token} invoices={data.invoices} terms={data.client.terms} />}
      {data.contactEmail && <p className="muted" style={{ marginTop: 24 }}>Questions? Email <a href={`mailto:${data.contactEmail}`}>{data.contactEmail}</a>. This page is private to you — please don’t share the link.</p>}
    </main>
  );
}

type Act = (b: object) => Promise<boolean>;

function Hours({ data, busy, act }: { data: Data; busy: boolean; act: Act }) {
  const weeks = useMemo(() => [...new Set(data.timesheets.map((t) => t.week))], [data.timesheets]);
  const [disputing, setDisputing] = useState<string | null>(null);
  const [text, setText] = useState('');
  if (!weeks.length) return <p className="card muted">No hours recorded in the last six weeks.</p>;
  return (
    <>{weeks.map((w) => {
      const rows = data.timesheets.filter((t) => t.week === w), open = rows.filter((t) => !t.approvedAt);
      return (
        <section key={w} className="card" style={{ marginBottom: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Week ending {fmt(w)}</h2>
            {open.length > 0 && <button className="btn sm" disabled={busy} onClick={() => act({ action: 'approve', timesheetIds: open.map((t) => t.id) })}>Approve {open.length === rows.length ? 'all' : `${open.length} remaining`}</button>}
          </div>
          <div className="tablewrap"><table><thead><tr><th>Worker</th><th>Regular</th><th>Overtime</th><th>Bill rate</th><th>Amount</th><th></th></tr></thead><tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td><b>{t.worker}</b><div className="muted">{t.job}</div></td><td>{t.reg}</td><td>{t.ot}</td><td>{money(t.billRate)}/hr</td><td>{money(t.amount)}</td>
                <td>
                  {t.approvedAt ? <span className="pill g">Approved{t.approvedBy ? ` by ${t.approvedBy.split(' ')[0]}` : ''}</span> : t.dispute ? <span className="pill r" title={t.dispute}>Questioned</span> : null}
                  {!t.approvedAt && disputing !== t.id && <button className="btn ghost sm" style={{ marginLeft: 6 }} onClick={() => { setDisputing(t.id); setText(''); }}>Something’s wrong</button>}
                  {disputing === t.id && (
                    <div className="subform">
                      <label>What looks wrong?<input value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="e.g. left at 3 pm on Tuesday" /></label>
                      <div className="row"><button className="btn sm" disabled={busy} onClick={async () => { if (await act({ action: 'dispute', timesheetId: t.id, note: text })) setDisputing(null); }}>Send</button><button className="btn ghost sm" onClick={() => setDisputing(null)}>Cancel</button></div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody></table></div>
        </section>
      );
    })}
    <p className="muted">Overtime bills at 1.5x. Approving confirms the hours were worked; your invoice uses the same numbers.</p></>
  );
}

function Schedule({ shifts }: { shifts: Data['shifts'] }) {
  if (!shifts.length) return <p className="card muted">No shifts scheduled for the next two weeks.</p>;
  const days = [...new Set(shifts.map((s) => s.date))];
  return <>{days.map((d) => (
    <section key={d} className="card" style={{ marginBottom: 12 }}>
      <h2 style={{ margin: 0, fontSize: 17 }}>{dayLabel(d, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
      <div className="list">{shifts.filter((s) => s.date === d).map((s) => (
        <div key={s.id} className="li"><div className="x"><b>{s.worker}</b><span className="muted">{s.job}{s.unit ? ` · ${s.unit}` : ''}</span></div>
          <span>{clockLong(s.start)} – {clockLong(s.end)} <span className={`pill ${s.confirmed ? 'g' : 'a'}`}>{s.confirmed ? 'Confirmed' : 'Scheduled'}</span></span></div>
      ))}</div>
    </section>
  ))}</>;
}

function Workers({ workers, busy, act }: { workers: Data['workers']; busy: boolean; act: Act }) {
  const [rating, setRating] = useState<{ id: string; stars: number; again: boolean | null; comment: string } | null>(null);
  if (!workers.length) return <p className="card muted">No one is on assignment with you right now.</p>;
  return (
    <div className="list card">{workers.map((w) => (
      <div key={w.applicationId} className="li" style={{ flexWrap: 'wrap' }}>
        <div className="x"><b>{w.name}</b><span className="muted">{w.job} · since {fmt(w.since)}</span></div>
        {rating?.id !== w.applicationId ? <button className="btn ghost sm" onClick={() => setRating({ id: w.applicationId, stars: 0, again: null, comment: '' })}>Rate</button> : (
          <div className="subform" style={{ width: '100%' }}>
            <div className="row" role="radiogroup" aria-label={`Rating for ${w.name}`}>{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={`btn sm ${rating.stars >= n ? '' : 'ghost'}`} aria-pressed={rating.stars === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => setRating({ ...rating, stars: n })}>★</button>)}</div>
            <div className="row"><span>Would you have them back?</span>{[true, false].map((v) => <label key={String(v)} className="check" style={{ margin: 0 }}><input type="radio" name={`again-${w.applicationId}`} checked={rating.again === v} onChange={() => setRating({ ...rating, again: v })} /> {v ? 'Yes' : 'No'}</label>)}</div>
            <label>Comments (optional)<textarea rows={2} maxLength={1000} value={rating.comment} onChange={(e) => setRating({ ...rating, comment: e.target.value })} /></label>
            <div className="row"><button className="btn sm" disabled={busy} onClick={async () => { if (await act({ action: 'rate', applicationId: w.applicationId, rating: rating.stars || undefined, wouldRehire: rating.again ?? undefined, comment: rating.comment || undefined })) setRating(null); }}>Send rating</button><button className="btn ghost sm" onClick={() => setRating(null)}>Cancel</button></div>
          </div>
        )}
      </div>
    ))}</div>
  );
}

function Jobs({ jobs, busy, act }: { jobs: Data['jobs']; busy: boolean; act: Act }) {
  const [form, setForm] = useState<null | { title: string; openings: string; startDate: string; shift: string; location: string; notes: string }>(null);
  return (
    <>
      {!form ? <p><button className="btn" onClick={() => setForm({ title: '', openings: '1', startDate: '', shift: '', location: '', notes: '' })}>+ Request staff</button></p> : (
        <section className="card">
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Request staff</h2>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label>Position<input value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Forklift operator" /></label>
            <label>How many<input type="number" min={1} max={500} value={form.openings} onChange={(e) => setForm({ ...form, openings: e.target.value })} style={{ width: 90 }} /></label>
            <label>Start date<input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label>Shift (optional)<input value={form.shift} maxLength={120} onChange={(e) => setForm({ ...form, shift: e.target.value })} placeholder="e.g. 2nd shift, 3–11:30 pm" /></label>
            <label>Location (optional)<input value={form.location} maxLength={120} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
          </div>
          <label>Anything else? (optional)<textarea rows={3} maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Skills, certifications, dress code, who they report to…" /></label>
          <div className="row"><button className="btn" disabled={busy} onClick={async () => { if (await act({ action: 'requestJob', ...form, openings: Number(form.openings) || 0, shift: form.shift || undefined, location: form.location || undefined, notes: form.notes || undefined })) setForm(null); }}>Send request</button><button className="btn ghost" onClick={() => setForm(null)}>Cancel</button></div>
        </section>
      )}
      {jobs.length ? <div className="tablewrap"><table><thead><tr><th>Position</th><th>Filled</th><th>Start</th><th>Bill rate</th><th>Status</th></tr></thead><tbody>
        {jobs.map((j) => <tr key={j.id}><td><b>{j.title}</b><div className="muted">{j.location}</div></td><td>{j.filled} of {j.openings}</td><td>{j.startDate ? fmt(j.startDate) : '—'}</td><td>{j.billRate ? `${money(j.billRate)}/hr` : '—'}</td><td><span className={`pill ${j.status === 'OPEN' ? 'g' : j.status === 'ON_HOLD' ? 'a' : ''}`}>{STATUS[j.status] ?? j.status}</span></td></tr>)}
      </tbody></table></div> : <p className="card muted">No job orders yet.</p>}
    </>
  );
}

function Invoices({ token, invoices, terms }: { token: string; invoices: Data['invoices']; terms: string }) {
  if (!invoices.length) return <p className="card muted">No invoices yet.</p>;
  const owed = invoices.reduce((s, i) => s + i.balance, 0);
  return (
    <>
      <p><b>{money(owed)}</b> open · terms {terms}</p>
      <div className="tablewrap"><table><thead><tr><th>Invoice</th><th>Issued</th><th>Due</th><th>Total</th><th>Balance</th><th></th></tr></thead><tbody>
        {invoices.map((i) => <tr key={i.id}><td><b>{i.number}</b></td><td>{fmt(i.issued)}</td><td>{fmt(i.due)}{i.overdue && <div className="warn">Past due</div>}</td><td>{money(i.total)}</td><td>{i.status === 'PAID' ? <span className="pill g">Paid</span> : money(i.balance)}</td><td><a className="btn ghost sm" href={`/api/portal/${token}/invoices/${i.id}`}>PDF</a></td></tr>)}
      </tbody></table></div>
    </>
  );
}
