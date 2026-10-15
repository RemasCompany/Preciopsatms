'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords, OpenRecord } from './Records';
import { BOARD_GROUPS, BOARD_INFO, type Board } from '@/lib/boards';

type Stats = Record<string, { applicants: number; hired: number }>;

export default function JobBoards({ base, slug, readOnly, indeed, warnings, boards, linkedin, stats }: {
  base: string; slug: string; readOnly: boolean; indeed: { apiToken: string | null; hasSecret: boolean }; warnings: { id: string; title: string; problem: string }[];
  boards: string[]; linkedin: string | null; stats: Stats;
}) {
  const router = useRouter();
  const { toast } = useRecords();
  const [token, setToken] = useState(indeed.apiToken ?? '');
  const [secret, setSecret] = useState('');
  const [liId, setLiId] = useState(linkedin ?? '');
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const feed = (b?: Board) => `${base}/api/public/${slug}/feed.xml${b ? `?board=${b}` : ''}`;
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch { toast('Select the address and copy it.', true); } };
  const all = Object.keys(BOARD_INFO) as Board[];
  const on = all.filter((b) => boards.includes(b));
  const total = (k: string) => stats[k] ?? { applicants: 0, hired: 0 };

  async function call(url: string, body: object, ok: string, key: string) {
    setBusy(key);
    const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setBusy('');
    if (!res.ok) return toast((await res.json().catch(() => ({}))).error ?? 'Could not save.', true);
    toast(ok); router.refresh();
  }
  const toggle = (b: Board, next: boolean) => {
    if (!next && !confirm(`Turn off ${BOARD_INFO[b].name}? Its feed empties, so the board drops your jobs the next time it reads it.`)) return;
    if (next) setOpen(b);
    call('/api/job-boards', { board: b, on: next }, next ? `${BOARD_INFO[b].name} is on. Give them the feed address below.` : `${BOARD_INFO[b].name} is off.`, b);
  };
  const connected = !!indeed.apiToken && indeed.hasSecret;

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Job boards</h2>
      <p className="muted" style={{ marginTop: 0 }}>Turn on the boards you use and give each one its feed address once. Open jobs are picked up automatically, filled and closed jobs drop off, and every applicant is tagged with the board they came from. On each job you can pick which boards it goes to; by default it goes to all of them.</p>
      <div className="kpis">
        <div className="kpi"><b>{on.length}</b><span>Boards on</span></div>
        <div className="kpi"><b>{on.reduce((n, b) => n + total(b).applicants, 0)}</b><span>Applicants from boards, 90 days</span></div>
        <div className="kpi"><b>{on.reduce((n, b) => n + total(b).hired, 0)}</b><span>Hired from boards, 90 days</span></div>
      </div>

      {BOARD_GROUPS.map((g) => (
        <div key={g}>
          <h3 className="boardgroup">{g}</h3>
          <div className="boards">{all.filter((b) => BOARD_INFO[b].group === g).map((b) => {
            const info = BOARD_INFO[b], isOn = boards.includes(b), s = total(b);
            return (
              <div key={b} className={`boardcard${isOn ? ' on' : ''}`}>
                <div className="boardhead">
                  <div><b>{info.name}</b><span className="muted">{info.best}</span></div>
                  <label className="switch" title={isOn ? 'On' : 'Off'}><input type="checkbox" checked={isOn} disabled={readOnly || busy === b} onChange={(e) => toggle(b, e.target.checked)} aria-label={`${info.name} ${isOn ? 'on' : 'off'}`} /><span /></label>
                </div>
                <div className="row" style={{ gap: 6, margin: '6px 0 0' }}>
                  <span className={`pill ${info.cost.startsWith('Free') ? 'g' : ''}`}>{info.cost}</span>
                  {isOn && <span className="muted" style={{ fontSize: 13 }}>{s.applicants} applicant{s.applicants === 1 ? '' : 's'}{s.hired ? ` · ${s.hired} hired` : ''} in 90 days</span>}
                </div>
                {isOn && (open === b ? <>
                  <p className="muted" style={{ fontSize: 13, margin: '8px 0 4px' }}>{info.how}</p>
                  <code className="feedurl">{feed(b)}</code>
                  {b === 'linkedin' && !readOnly && (
                    <div className="row" style={{ marginTop: 6 }}>
                      <input value={liId} inputMode="numeric" placeholder="LinkedIn company ID" aria-label="LinkedIn company ID" onChange={(e) => setLiId(e.target.value)} style={{ flex: 1 }} />
                      <button className="btn ghost sm" disabled={busy === 'li'} onClick={() => call('/api/job-boards', { linkedinCompanyId: liId }, 'LinkedIn company ID saved.', 'li')}>Save</button>
                    </div>
                  )}
                  <div className="row" style={{ marginTop: 6 }}><button className="btn ghost sm" onClick={() => copy(feed(b))}>Copy address</button><a className="btn ghost sm" href={feed(b)} target="_blank" rel="noopener">Preview feed</a><button className="btn ghost sm" onClick={() => setOpen(null)}>Hide</button></div>
                </> : <button className="linkbtn" style={{ fontSize: 13, marginTop: 6 }} onClick={() => setOpen(b)}>Setup and feed address</button>)}
              </div>
            );
          })}</div>
        </div>
      ))}

      <div className="li" style={{ marginTop: 14 }}><span className="x"><b>Any other board</b><span className="muted">Most boards and aggregators accept this Indeed-format XML feed of every published job.</span><code className="feedurl">{feed()}</code></span>
        <span className="row"><button className="btn ghost sm" onClick={() => copy(feed())}>Copy</button></span></div>
      <p className="muted">Google for Jobs reads the structured data on each job’s careers page — no feed or setup needed. Glassdoor shows jobs from Indeed. Costs and feed rules are set by each board and change from time to time; confirm with the board before you rely on them.</p>

      {warnings.length > 0 && (
        <div className="aiout">
          <b>{warnings.length} fix{warnings.length === 1 ? '' : 'es'} before boards will show every job</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{warnings.map((w, i) => <li key={i}><OpenRecord kind="jobs" id={w.id} className="link inline">{w.title}</OpenRecord>: {w.problem}</li>)}</ul>
        </div>
      )}

      <h3 style={{ marginTop: 22 }}>Indeed Apply {connected ? <span className="pill g">Connected</span> : <span className="pill">Not set up</span>}</h3>
      <p className="muted">Let candidates apply without leaving Indeed. Indeed sends each application straight into your pipeline with the resume attached. Get an API token and secret from Indeed’s partner console, and give Indeed this application URL:</p>
      <code className="feedurl">{`${base}/api/public/${slug}/indeed-apply`}</code>
      {!readOnly && (
        <div className="form wide" style={{ marginTop: 10 }}>
          <label><span>API token</span><input value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" /></label>
          <label><span>Secret {indeed.hasSecret && '(saved — enter a new one to replace it)'}</span><input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" placeholder={indeed.hasSecret ? '••••••••' : ''} /></label>
        </div>
      )}
      {!readOnly && (
        <div className="row">
          <button className="btn" disabled={busy === 'ia' || (!token.trim() && !secret.trim())} onClick={() => call('/api/org', { indeedApplyApiToken: token, ...(secret ? { indeedApplySecret: secret } : {}) }, 'Indeed Apply settings saved.', 'ia').then(() => setSecret(''))}>Save Indeed Apply</button>
          {connected && <button className="btn ghost" disabled={busy === 'ia'} onClick={() => confirm('Turn off Indeed Apply? Jobs will send candidates to your careers page instead.') && call('/api/org', { indeedApplyApiToken: null, indeedApplySecret: null }, 'Indeed Apply turned off.', 'ia')}>Disconnect</button>}
        </div>
      )}
    </section>
  );
}
