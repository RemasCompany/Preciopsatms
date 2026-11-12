'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Key = { id: string; name: string; prefix: string; created: string; lastUsed: string | null };

/** Settings → API keys (Enterprise): create, copy once, revoke; plus a short reference for developers. */
export default function ApiKeys({ keys, canEdit, upgrade, base }: { keys: Key[]; canEdit: boolean; upgrade: boolean; base: string }) {
  const router = useRouter();
  const [name, setName] = useState(''); const [fresh, setFresh] = useState<string | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [confirming, setConfirming] = useState<string | null>(null);
  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(''); setFresh(null);
    const r = await fetch('/api/settings/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => null);
    const j = await r?.json().catch(() => ({})) ?? {};
    setBusy(false);
    if (!r?.ok) { setErr(j.error ?? 'That didn’t work. Try again.'); return; }
    setFresh(j.key); setName(''); router.refresh();
  }
  async function revoke(id: string) {
    setErr('');
    const r = await fetch(`/api/settings/api-keys/${id}`, { method: 'DELETE' }).catch(() => null);
    const j = await r?.json().catch(() => ({})) ?? {};
    setConfirming(null);
    if (!r?.ok) { setErr(j.error ?? 'That didn’t work. Try again.'); return; }
    router.refresh();
  }
  return (
    <section className="card" aria-labelledby="apikeys">
      <h2 id="apikeys" style={{ marginTop: 0 }}>API keys</h2>
      {upgrade ? <p className="muted">Connect your own systems (data warehouse, HRIS, a client’s portal) to Preciops with the API. It’s part of the Enterprise plan. <a href="/app/billing">See plans</a></p> : (
        <>
          <p className="muted">Each key reads and adds your company’s jobs, candidates, applications, employees and timesheets. Treat it like a password. EEO answers are never available through the API.</p>
          {fresh && (
            <div className="banner" role="status">
              <p style={{ margin: '0 0 6px' }}><b>Copy this key now.</b> It won’t be shown again.</p>
              <code style={{ overflowWrap: 'anywhere', display: 'block', marginBottom: 6 }}>{fresh}</code>
              <button className="btn sm" type="button" onClick={() => navigator.clipboard?.writeText(fresh).catch(() => undefined)}>Copy</button>
            </div>
          )}
          {err && <p className="error" role="alert">{err}</p>}
          {keys.length ? (
            <ul className="plainlist">{keys.map((k) => (
              <li key={k.id}>
                <span><b>{k.name}</b> <code>{k.prefix}…</code><br /><span className="muted">Created {k.created} · {k.lastUsed ? `last used ${new Date(k.lastUsed).toLocaleString()}` : 'never used'}</span></span>
                {canEdit && (confirming === k.id
                  ? <span className="row"><button className="btn danger sm" onClick={() => revoke(k.id)}>Revoke — it stops working now</button><button className="btn ghost sm" onClick={() => setConfirming(null)}>Keep</button></span>
                  : <button className="btn ghost sm" onClick={() => setConfirming(k.id)}>Revoke</button>)}
              </li>
            ))}</ul>
          ) : <p className="muted">No keys yet.</p>}
          {canEdit && (
            <form className="row" onSubmit={create} style={{ marginTop: 10 }}>
              <input aria-label="Key name" placeholder="What will use it? e.g. Data warehouse" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
              <button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create key'}</button>
            </form>
          )}
          <details style={{ marginTop: 12 }}>
            <summary>How to use it</summary>
            <p>Send the key in a header: <code>Authorization: Bearer pk_live_…</code>. Up to 120 requests a minute per key. Lists return <code>{'{ data, nextCursor }'}</code>; pass <code>?cursor=</code> for the next page, <code>?limit=</code> (up to 200) and <code>?updatedSince=</code> to sync changes.</p>
            <ul>
              <li><code>GET {base}/api/v1/jobs</code> · <code>GET /api/v1/jobs/:id</code> · <code>POST /api/v1/jobs</code> (unpublished unless <code>&quot;publish&quot;: true</code>)</li>
              <li><code>GET /api/v1/candidates</code> (<code>?email=</code>) · <code>GET /api/v1/candidates/:id</code> · <code>POST /api/v1/candidates</code></li>
              <li><code>GET /api/v1/applications</code> (<code>?jobId=</code>, <code>?candidateId=</code>, <code>?stage=</code>)</li>
              <li><code>GET /api/v1/employees</code> · <code>GET /api/v1/timesheets</code> (<code>?weekEnding=</code>, <code>?status=</code>)</li>
            </ul>
            <pre style={{ overflowX: 'auto' }}>{`curl ${base}/api/v1/jobs?status=OPEN \\\n  -H "Authorization: Bearer pk_live_…"`}</pre>
          </details>
        </>
      )}
    </section>
  );
}
