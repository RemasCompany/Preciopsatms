'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRecords } from './Records';

type Check = { id: string; package: string; status: string; orderedAt: string; completedAt: string | null; externalReportId: string | null };
const LABEL: Record<string, string> = { invited: 'Waiting for candidate', pending: 'In progress', clear: 'Clear', consider: 'Needs review', suspended: 'Suspended', canceled: 'Canceled', dispute: 'Disputed', expired: 'Invitation expired' };
const PILL: Record<string, string> = { clear: 'g', consider: 'r', suspended: 'r', dispute: 'r', invited: 'a', pending: 'a' };
const STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');

/** Background checks in the candidate drawer: order through Checkr, follow status (updated by Checkr's webhook). */
export default function BackgroundChecks({ candidateId, canEdit }: { candidateId: string; canEdit: boolean }) {
  const { toast } = useRecords();
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [dashboard, setDashboard] = useState('');
  const [pkgs, setPkgs] = useState<{ slug: string; name: string }[] | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [form, setForm] = useState<{ package: string; state: string; city: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch(`/api/background-checks?candidate=${candidateId}`);
    if (r.ok) { const j = await r.json(); setChecks(j.checks); setDashboard(j.dashboard); }
  }, [candidateId]);
  useEffect(() => { load(); }, [load]);

  async function start() {
    const r = await fetch('/api/background-checks/packages');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return toast(j.error ?? 'Couldn’t reach Checkr.', true);
    setEnabled(j.enabled); setPkgs(j.packages);
    if (j.enabled) setForm({ package: j.packages[0]?.slug ?? '', state: 'FL', city: '' });
  }
  async function order() {
    if (!form) return;
    setBusy(true);
    const r = await fetch('/api/background-checks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidateId, ...form, city: form.city || undefined }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast(j.error ?? 'Couldn’t order the check.', true);
    toast('Ordered. Checkr has emailed the candidate to consent and fill in their details.'); setForm(null); load();
  }

  return (
    <section className="sec"><h3>Background checks {canEdit && !form && <button className="btn ghost sm" onClick={start}>+ Order check</button>}</h3>
      {enabled === false && <p className="muted">Background checks through Checkr aren’t set up yet. An admin adds the Checkr API key to the server (CHECKR_API_KEY) to turn them on.</p>}
      {form && pkgs && (
        <div className="subform">
          <label>Package<select value={form.package} onChange={(e) => setForm({ ...form, package: e.target.value })}>{pkgs.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></label>
          <div className="row"><label>Work state<select value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}>{STATES.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label>City (optional)<input value={form.city} maxLength={80} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label></div>
          <p className="muted">Checkr emails the candidate to give consent and enter their SSN and date of birth on Checkr’s site — that information never passes through Preciops.</p>
          <div className="row"><button className="btn sm" disabled={busy || !form.package} onClick={order}>{busy ? 'Ordering…' : 'Order'}</button><button className="btn ghost sm" onClick={() => setForm(null)}>Cancel</button></div>
        </div>
      )}
      {checks?.length ? <div className="list">{checks.map((c) => (
        <div key={c.id} className="li"><span className="x"><b>{c.package}</b><span className="muted">Ordered {new Date(c.orderedAt).toLocaleDateString()}{c.completedAt ? ` · completed ${new Date(c.completedAt).toLocaleDateString()}` : ''}{c.externalReportId && dashboard ? <> · <a href={`${dashboard}/reports/${c.externalReportId}`} target="_blank" rel="noopener noreferrer">report</a></> : null}</span></span>
          <span className={`pill ${PILL[c.status] ?? ''}`}>{LABEL[c.status] ?? c.status}</span></div>
      ))}</div> : checks && !form && enabled !== false ? <p className="muted">None ordered.</p> : null}
      {checks?.some((c) => c.status === 'consider') && <p className="warn">A “needs review” result isn’t a fail. Review the report in Checkr and, before deciding not to hire, follow the FCRA adverse-action steps (pre-adverse notice, a copy of the report, and time to respond).</p>}
    </section>
  );
}
