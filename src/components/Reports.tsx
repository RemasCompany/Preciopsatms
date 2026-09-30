'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords } from './Records';
import type { Table } from '@/lib/reports';

type Def = { key: string; title: string; description: string };
type Sched = { id: string; report: string; frequency: string; recipients: string[]; branch: string | null };
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const ymd = (d: Date) => d.toISOString().slice(0, 10);

function presets(today: string) {
  const t = new Date(`${today}T00:00:00Z`), y = t.getUTCFullYear(), m = t.getUTCMonth();
  return {
    'This month': [ymd(new Date(Date.UTC(y, m, 1))), today], 'Last month': [ymd(new Date(Date.UTC(y, m - 1, 1))), ymd(new Date(Date.UTC(y, m, 0)))],
    'Last 90 days': [ymd(new Date(t.getTime() - 89 * 864e5)), today], 'This year': [`${y}-01-01`, today],
  } as Record<string, [string, string]>;
}

export default function Reports({ defs, today, branches, current, isAdmin, schedules, team }: {
  defs: Def[]; today: string; branches: { id: string; name: string }[]; current: string | null; isAdmin: boolean; schedules: Sched[]; team: { id: string; name: string; admin: boolean }[];
}) {
  const router = useRouter();
  const { toast } = useRecords();
  const [key, setKey] = useState(defs[0]?.key ?? '');
  const [[from, to], setRange] = useState<[string, string]>(presets(today)['This month']);
  const [branch, setBranch] = useState(current ?? 'all');
  const [t, setT] = useState<Table | null>(null);
  const [err, setErr] = useState('');
  const [sched, setSched] = useState<{ frequency: string; userIds: string[] } | null>(null);
  const qs = `from=${from}&to=${to}&branch=${branch}`;
  const load = useCallback(async () => {
    setErr('');
    const r = await fetch(`/api/reports/${key}?${qs}`);
    const j = await r.json().catch(() => ({}));
    if (r.ok) setT(j); else { setT(null); setErr(j.error ?? 'Could not run the report.'); }
  }, [key, qs]);
  useEffect(() => { if (key) load(); }, [load, key]);
  const def = defs.find((d) => d.key === key);
  const fmt = (c: Table['columns'][number], v: unknown) => v == null || v === '' ? '—' : c.money ? money(Number(v)) : c.pct ? `${v}%` : String(v);

  async function saveSchedule() {
    if (!sched) return;
    const r = await fetch('/api/reports/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report: key, frequency: sched.frequency, userIds: sched.userIds, branchId: branch === 'all' ? null : branch }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return toast(j.error ?? 'Could not schedule it.', true);
    toast(`Scheduled: ${def?.title} every ${sched.frequency === 'weekly' ? 'Monday' : '1st of the month'}.`); setSched(null); router.refresh();
  }

  return (
    <>
      <div className="bar" style={{ flexWrap: 'wrap' }}>
        <select value={key} onChange={(e) => setKey(e.target.value)} aria-label="Report">{defs.map((d) => <option key={d.key} value={d.key}>{d.title}</option>)}</select>
        <input type="date" value={from} onChange={(e) => setRange([e.target.value, to])} aria-label="From" />
        <input type="date" value={to} onChange={(e) => setRange([from, e.target.value])} aria-label="To" />
        {Object.entries(presets(today)).map(([l, r]) => <button key={l} className={`btn sm ${r[0] === from && r[1] === to ? '' : 'ghost'}`} onClick={() => setRange(r)}>{l}</button>)}
        {branches.length > 0 && <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch"><option value="all">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
        <span className="grow" />
        <a className="btn ghost" href={`/api/reports/${key}?${qs}&format=csv`}>Download CSV</a>
        {isAdmin && <button className="btn ghost" onClick={() => setSched({ frequency: 'weekly', userIds: [] })}>Email this report…</button>}
      </div>
      {def && <p className="muted">{def.description}</p>}
      {sched && (
        <div className="card subform">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label>How often<select value={sched.frequency} onChange={(e) => setSched({ ...sched, frequency: e.target.value })}><option value="weekly">Weekly, Mondays (last week)</option><option value="monthly">Monthly, the 1st (last month)</option></select></label>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>{team.map((m) => <label key={m.id} className="check" style={{ margin: 0 }}><input type="checkbox" checked={sched.userIds.includes(m.id)} onChange={(e) => setSched({ ...sched, userIds: e.target.checked ? [...sched.userIds, m.id] : sched.userIds.filter((x) => x !== m.id) })} /> {m.name}</label>)}</div>
          <p className="muted">Sent as a CSV attachment{branch !== 'all' ? ' for this branch' : ''}. Reports with pay or margin only go to owners and admins.</p>
          <div className="row"><button className="btn sm" disabled={!sched.userIds.length} onClick={saveSchedule}>Schedule</button><button className="btn ghost sm" onClick={() => setSched(null)}>Cancel</button></div>
        </div>
      )}
      {err && <p className="error" role="alert">{err}</p>}
      {t && (t.rows.length ? (
        <div className="tablewrap"><table><thead><tr>{t.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead><tbody>
          {t.rows.map((r, i) => <tr key={i}>{t.columns.map((c) => <td key={c.key}>{fmt(c, r[c.key])}</td>)}</tr>)}
          {t.total && <tr>{t.columns.map((c) => <td key={c.key}><b>{t.total![c.key] == null ? '' : fmt(c, t.total![c.key])}</b></td>)}</tr>}
        </tbody></table></div>
      ) : <div className="card empty"><b>Nothing in this period</b>Try a longer date range{branches.length ? ' or all branches' : ''}.</div>)}
      {t?.note && <p className="muted">{t.note}</p>}
      {isAdmin && schedules.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Scheduled emails</h2>
          <div className="list">{schedules.map((s) => (
            <div key={s.id} className="li"><span className="x"><b>{defs.find((d) => d.key === s.report)?.title ?? s.report}{s.branch ? ` — ${s.branch}` : ''}</b><span className="muted">{s.frequency === 'weekly' ? 'Mondays' : '1st of the month'} · {s.recipients.join(', ')}</span></span>
              <button className="btn ghost sm" onClick={async () => { const r = await fetch(`/api/reports/schedules/${s.id}`, { method: 'DELETE' }); if (r.ok) { toast('Stopped.'); router.refresh(); } }}>Stop</button></div>
          ))}</div>
        </section>
      )}
    </>
  );
}
