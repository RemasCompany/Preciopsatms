'use client';
import { useState } from 'react';

/** Client contacts ask for a fresh portal link (their staffing company is in ?c=slug from the link email). */
export default function PortalLogin({ searchParams }: { searchParams: { c?: string } }) {
  const [slug, setSlug] = useState(searchParams.c ?? '');
  const [msg, setMsg] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(''); setBusy(true);
    const r = await fetch('/api/portal/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, email: new FormData(e.currentTarget).get('email') }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) setMsg(j.message); else setErr(j.error ?? 'Something went wrong. Try again.');
  }
  return (
    <main className="public" style={{ maxWidth: 440 }}>
      <h1>Client portal</h1>
      {msg ? <p className="card banner" role="status">{msg}</p> : (
        <form className="card" onSubmit={submit}>
          <p className="muted" style={{ marginTop: 0 }}>Enter your work email and we’ll send you a private sign-in link. No password needed.</p>
          {!searchParams.c && <label>Staffing company’s code<input value={slug} onChange={(e) => setSlug(e.target.value)} required placeholder="from your portal email, e.g. demo-staffing" /></label>}
          <label>Work email<input name="email" type="email" required autoComplete="email" /></label>
          {err && <p className="error" role="alert">{err}</p>}
          <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Email me a link'}</button>
        </form>
      )}
    </main>
  );
}
