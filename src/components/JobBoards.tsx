'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords, OpenRecord } from './Records';
import { BOARDS, type Board } from '@/lib/boards';


export default function JobBoards({ base, slug, readOnly, indeed, warnings }: {
  base: string; slug: string; readOnly: boolean; indeed: { apiToken: string | null; hasSecret: boolean }; warnings: { id: string; title: string; problem: string }[];
}) {
  const router = useRouter();
  const { toast } = useRecords();
  const [token, setToken] = useState(indeed.apiToken ?? '');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const feed = (b?: Board) => `${base}/api/public/${slug}/feed.xml${b ? `?board=${b}` : ''}`;
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch { toast('Select the address and copy it.', true); } };

  async function save(patch: Record<string, string | null>) {
    setBusy(true);
    const res = await fetch('/api/org', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    setBusy(false);
    if (!res.ok) return toast((await res.json().catch(() => ({}))).error ?? 'Could not save.', true);
    setSecret(''); toast('Indeed Apply settings saved.'); router.refresh();
  }
  const connected = !!indeed.apiToken && indeed.hasSecret;

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Job boards</h2>
      <p className="muted" style={{ marginTop: 0 }}>Submit each board’s address once, through its employer XML-feed program or your account rep. Open jobs are picked up automatically, filled and closed jobs drop off, and applicants are tagged with the board they came from.</p>
      <div className="list">
        {(Object.keys(BOARDS) as Board[]).map((b) => (
          <div key={b} className="li">
            <span className="x"><b>{BOARDS[b]}</b><code className="feedurl">{feed(b)}</code></span>
            <span className="row"><button className="btn ghost sm" onClick={() => copy(feed(b))}>Copy</button><a className="btn ghost sm" href={feed(b)} target="_blank" rel="noopener">Preview</a></span>
          </div>
        ))}
        <div className="li"><span className="x"><b>Other aggregators</b><span className="muted">Any board that accepts Indeed-format XML.</span><code className="feedurl">{feed()}</code></span>
          <span className="row"><button className="btn ghost sm" onClick={() => copy(feed())}>Copy</button></span></div>
      </div>
      <p className="muted">Google for Jobs reads the structured data on each job’s careers page — no feed needed. LinkedIn job slots and Limited Listings are set up through a LinkedIn partner, which can use the same feed.</p>

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
          <button className="btn" disabled={busy || (!token.trim() && !secret.trim())} onClick={() => save({ indeedApplyApiToken: token, ...(secret ? { indeedApplySecret: secret } : {}) })}>Save Indeed Apply</button>
          {connected && <button className="btn ghost" disabled={busy} onClick={() => confirm('Turn off Indeed Apply? Jobs will send candidates to your careers page instead.') && save({ indeedApplyApiToken: null, indeedApplySecret: null })}>Disconnect</button>}
        </div>
      )}
    </section>
  );
}
